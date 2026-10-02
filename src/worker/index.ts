/**
 * Proceso worker de MC Send Notify: procesa las colas de BullMQ.
 * Comparte `src/core` e `src/infrastructure` con la app; se ejecuta en su propio contenedor.
 * Autor: Ing. Heri Espinosa
 */
import { Queue, Worker } from 'bullmq';
import type { Server } from 'node:http';
import { getServerEnv } from '@/common/config/env';
import {
  configureContainer,
  getLogger,
  getWorkerHeartbeat,
  shutdownContainer,
} from '@/infrastructure/container';
import { createRedisConnection } from '@/infrastructure/queue/connection';
import { QUEUE_NAMES } from '@/infrastructure/queue/queue-names';
import { startHealthServer } from './health-server';
import { createMaintenanceProcessor } from './processors/maintenance.processor';
import { registerMaintenanceSchedulers } from './schedulers';

async function main(): Promise<void> {
  const env = getServerEnv();
  configureContainer({ service: 'worker' });
  const logger = getLogger();
  const connection = createRedisConnection(env.REDIS_URL, 'worker');

  const maintenanceQueue = new Queue(QUEUE_NAMES.maintenance, { connection });
  const maintenanceWorker = new Worker(
    QUEUE_NAMES.maintenance,
    createMaintenanceProcessor(getWorkerHeartbeat()),
    { connection, concurrency: 1 },
  );
  maintenanceWorker.on('failed', (job, error) =>
    logger.error({ err: error, queue: QUEUE_NAMES.maintenance, jobName: job?.name }, 'Job fallido'),
  );
  maintenanceWorker.on('error', (error) => logger.error({ err: error }, 'Error del worker'));

  await registerMaintenanceSchedulers(maintenanceQueue);

  const workers = [maintenanceWorker];
  const healthServer: Server = await startHealthServer(env.WORKER_HEALTH_PORT, () => ({
    redis: connection.status === 'ready',
    workers: Object.fromEntries(workers.map((worker) => [worker.name, worker.isRunning()])),
  }));
  logger.info(
    { port: env.WORKER_HEALTH_PORT, queues: workers.map((w) => w.name) },
    'Worker iniciado',
  );

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Deteniendo el worker');
    healthServer.close();
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await maintenanceQueue.close();
    await connection.quit();
    await shutdownContainer();
    process.exit(0);
  };
  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));
}

main().catch((error: unknown) => {
  console.error('El worker no pudo iniciar:', error);
  process.exit(1);
});
