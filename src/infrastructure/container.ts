/**
 * Composition root compartido por la app (Next.js) y el worker.
 *
 * Expone fábricas con singleton perezoso guardado en `globalThis`, para que el HMR de desarrollo
 * no cree varias conexiones a PostgreSQL o Redis. No se usa librería de inyección de
 * dependencias: los casos de uso reciben sus puertos desde aquí.
 */
import { createMCLogClient } from '@multicomputos-srl/mclog';
import type { Redis } from 'ioredis';
import { getServerEnv } from '@/common/config/env';
import { createLogger, type Logger } from './observability/logger';
import { MCLogBatchStream } from './observability/mclog.transport';
import { httpHealthCheck, type HealthCheck } from './observability/readiness';
import { WorkerHeartbeat, workerHeartbeatHealthCheck } from './observability/worker-heartbeat';
import { createPrismaClient, type PrismaClient } from './persistence/prisma/client';
import { createRedisConnection } from './queue/connection';

export type ServiceName = 'web' | 'worker';

interface ContainerState {
  service: ServiceName;
  prisma?: PrismaClient;
  redis?: Redis;
  logger?: Logger;
  mclogStream?: MCLogBatchStream;
}

const globalForContainer = globalThis as typeof globalThis & { __mcsnContainer?: ContainerState };
const state: ContainerState = (globalForContainer.__mcsnContainer ??= { service: 'web' });

/** Indica qué proceso usa el contenedor. Debe llamarse antes del primer `getLogger()`. */
export function configureContainer(options: { service: ServiceName }): void {
  state.service = options.service;
}

function createMCLogStream(): MCLogBatchStream | undefined {
  const env = getServerEnv();
  if (!env.MCLOG_URL || !env.MCLOG_API_KEY) {
    return undefined;
  }
  const client = createMCLogClient({
    baseUrl: env.MCLOG_URL,
    apiKey: env.MCLOG_API_KEY,
    application: env.MCLOG_APPLICATION,
    environment: env.APP_ENV,
    service: state.service,
    onError: (error) => console.warn(`MCLog no disponible: ${error.message}`),
  });
  return new MCLogBatchStream({ sender: client });
}

export function getLogger(): Logger {
  if (!state.logger) {
    const env = getServerEnv();
    state.mclogStream = createMCLogStream();
    state.logger = createLogger({
      level: env.LOG_LEVEL,
      service: state.service,
      extraStreams: state.mclogStream ? [{ level: 'warn', stream: state.mclogStream }] : [],
    });
  }
  return state.logger;
}

export function getPrisma(): PrismaClient {
  state.prisma ??= createPrismaClient(getServerEnv().DATABASE_URL);
  return state.prisma;
}

/** Conexión Redis de propósito general (no bloqueante). */
export function getRedis(): Redis {
  state.redis ??= createRedisConnection(getServerEnv().REDIS_URL, 'client');
  return state.redis;
}

export function getWorkerHeartbeat(): WorkerHeartbeat {
  return new WorkerHeartbeat(getRedis());
}

/** Dependencias que la app necesita para atender peticiones. */
export function getReadinessChecks(): HealthCheck[] {
  const env = getServerEnv();
  return [
    {
      name: 'database',
      critical: true,
      async check() {
        await getPrisma().$queryRaw`SELECT 1`;
      },
    },
    {
      name: 'redis',
      critical: true,
      async check() {
        await getRedis().ping();
      },
    },
    httpHealthCheck('gotenberg', new URL('/health', env.GOTENBERG_URL).toString(), false),
    workerHeartbeatHealthCheck(getWorkerHeartbeat()),
  ];
}

/** Cierre ordenado: envía los logs pendientes y libera conexiones. */
export async function shutdownContainer(): Promise<void> {
  await state.mclogStream?.close();
  await Promise.allSettled([state.prisma?.$disconnect(), state.redis?.quit()]);
  state.prisma = undefined;
  state.redis = undefined;
}
