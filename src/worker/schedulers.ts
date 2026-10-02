/**
 * Jobs programados (BullMQ Job Schedulers). `upsertJobScheduler` es idempotente:
 * se puede llamar en cada arranque sin duplicar programaciones.
 */
import type { Queue } from 'bullmq';
import { MAINTENANCE_JOBS } from '@/infrastructure/queue/queue-names';

export const HEARTBEAT_INTERVAL_MS = 30_000;

export async function registerMaintenanceSchedulers(maintenanceQueue: Queue): Promise<void> {
  await maintenanceQueue.upsertJobScheduler(
    'maintenance-heartbeat',
    { every: HEARTBEAT_INTERVAL_MS },
    {
      name: MAINTENANCE_JOBS.heartbeat,
      opts: { removeOnComplete: true, removeOnFail: 100 },
    },
  );
}
