/**
 * Composition root compartido por la app (Next.js) y el worker.
 *
 * Expone fábricas con singleton perezoso guardado en `globalThis`, para que el HMR de desarrollo
 * no cree varias conexiones a PostgreSQL o Redis. No se usa librería de inyección de
 * dependencias: los casos de uso se construyen en `use-case-factory.ts` con estas piezas.
 */
import { createMCLogClient } from '@multicomputos-srl/mclog';
import type { Redis } from 'ioredis';
import { getServerEnv } from '@/common/config/env';
import { PapaXlsxSpreadsheetReader } from './import/spreadsheet-reader';
import { createLogger, type Logger } from './observability/logger';
import { MCLogBatchStream } from './observability/mclog.transport';
import { httpHealthCheck, type HealthCheck } from './observability/readiness';
import { WorkerHeartbeat, workerHeartbeatHealthCheck } from './observability/worker-heartbeat';
import { createPrismaClient, type PrismaClient } from './persistence/prisma/client';
import { TenantClientCache } from './persistence/prisma/tenant-scope.extension';
import { createRedisConnection } from './queue/connection';
import { BullContactImportQueue } from './queue/jobs';
import { RateLimiter, RATE_LIMITS } from './security/rate-limiter';
import { S3ObjectStorage } from './storage/s3.object-storage';

export type ServiceName = 'web' | 'worker';

interface ContainerState {
  service: ServiceName;
  prisma?: PrismaClient;
  tenantClients?: TenantClientCache;
  redis?: Redis;
  logger?: Logger;
  mclogStream?: MCLogBatchStream;
  storage?: S3ObjectStorage;
  contactImportQueue?: BullContactImportQueue;
  rateLimiters?: Map<keyof typeof RATE_LIMITS, RateLimiter>;
  memo?: Map<string, unknown>;
}

const globalForContainer = globalThis as typeof globalThis & { __mcsnContainer?: ContainerState };
const state: ContainerState = (globalForContainer.__mcsnContainer ??= { service: 'web' });

/** Indica qué proceso usa el contenedor. Debe llamarse antes del primer `getLogger()`. */
export function configureContainer(options: { service: ServiceName }): void {
  state.service = options.service;
}

/** Singleton perezoso para objetos sin estado (repositorios, casos de uso). */
export function memoize<T>(key: string, create: () => T): T {
  state.memo ??= new Map();
  if (!state.memo.has(key)) state.memo.set(key, create());
  return state.memo.get(key) as T;
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

/** Clientes Prisma acotados por tenant (aislamiento en la capa de datos). */
export function getTenantClients(): TenantClientCache {
  state.tenantClients ??= new TenantClientCache(getPrisma());
  return state.tenantClients;
}

/** Conexión Redis de propósito general (no bloqueante). */
export function getRedis(): Redis {
  state.redis ??= createRedisConnection(getServerEnv().REDIS_URL, 'client');
  return state.redis;
}

export function getObjectStorage(): S3ObjectStorage {
  if (!state.storage) {
    const env = getServerEnv();
    state.storage = new S3ObjectStorage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return state.storage;
}

export function getSpreadsheetReader(): PapaXlsxSpreadsheetReader {
  return memoize('spreadsheetReader', () => new PapaXlsxSpreadsheetReader());
}

export function getContactImportQueue(): BullContactImportQueue {
  state.contactImportQueue ??= new BullContactImportQueue(getRedis());
  return state.contactImportQueue;
}

export function getRateLimiter(name: keyof typeof RATE_LIMITS): RateLimiter {
  state.rateLimiters ??= new Map();
  let limiter = state.rateLimiters.get(name);
  if (!limiter) {
    limiter = new RateLimiter(getRedis(), RATE_LIMITS[name]);
    state.rateLimiters.set(name, limiter);
  }
  return limiter;
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
    {
      name: 'storage',
      critical: true,
      async check() {
        await getObjectStorage().ping();
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
  state.tenantClients = undefined;
  state.memo = undefined;
}
