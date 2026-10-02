/**
 * Proceso worker de MC Send Notify: procesa las colas de BullMQ.
 * Comparte `src/core` e `src/infrastructure` con la app; se ejecuta en su propio contenedor.
 * Autor: Ing. Heri Espinosa
 */
import { Queue, Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Server } from 'node:http';
import { getServerEnv } from '@/common/config/env';
import {
  configureContainer,
  getLogger,
  getObjectStorage,
  getWorkerHeartbeat,
  shutdownContainer,
} from '@/infrastructure/container';
import type { Logger } from '@/infrastructure/observability/logger';
import { createRedisConnection } from '@/infrastructure/queue/connection';
import { QUEUE_NAMES, type QueueName } from '@/infrastructure/queue/queue-names';
import { useCases } from '@/infrastructure/use-case-factory';
import { startHealthServer } from './health-server';
import { createContactImportProcessor } from './processors/contact-import.processor';
import { createDocumentProcessor } from './processors/document-process.processor';
import { createMaintenanceProcessor } from './processors/maintenance.processor';
import { registerMaintenanceSchedulers } from './schedulers';

function startWorker(
  name: QueueName,
  processor: Processor,
  options: { connection: Redis; concurrency: number; logger: Logger },
): Worker {
  const worker = new Worker(name, processor, {
    connection: options.connection,
    concurrency: options.concurrency,
  });
  worker.on('failed', (job, error) =>
    options.logger.error(
      { err: error, queue: name, jobName: job?.name, attemptsMade: job?.attemptsMade },
      'Job fallido',
    ),
  );
  worker.on('error', (error) =>
    options.logger.error({ err: error, queue: name }, 'Error del worker'),
  );
  return worker;
}

async function main(): Promise<void> {
  const env = getServerEnv();
  configureContainer({ service: 'worker' });
  const logger = getLogger();
  const connection = createRedisConnection(env.REDIS_URL, 'worker');

  await getObjectStorage().ensureBucket();

  const maintenanceQueue = new Queue(QUEUE_NAMES.maintenance, { connection });
  const workers = [
    startWorker(QUEUE_NAMES.maintenance, createMaintenanceProcessor(getWorkerHeartbeat()), {
      connection,
      concurrency: 1,
      logger,
    }),
    startWorker(
      QUEUE_NAMES.contactImport,
      createContactImportProcessor({ processImport: useCases.processImport() }),
      { connection, concurrency: 2, logger },
    ),
    startWorker(
      QUEUE_NAMES.documentProcess,
      createDocumentProcessor({ processDocument: useCases.processDocument() }),
      { connection, concurrency: 2, logger },
    ),
  ];

  await registerMaintenanceSchedulers(maintenanceQueue);

  const healthServer: Server = await startHealthServer(env.WORKER_HEALTH_PORT, () => ({
    redis: connection.status === 'ready',
    workers: Object.fromEntries(workers.map((worker) => [worker.name, worker.isRunning()])),
  }));
  logger.info(
    { port: env.WORKER_HEALTH_PORT, queues: workers.map((worker) => worker.name) },
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
