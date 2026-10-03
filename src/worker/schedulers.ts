/**
 * Jobs programados (BullMQ Job Schedulers). `upsertJobScheduler` es idempotente:
 * se puede llamar en cada arranque sin duplicar programaciones.
 */
import type { Queue } from 'bullmq';
import { MAINTENANCE_JOBS } from '@/infrastructure/queue/queue-names';

export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Cierre de campañas terminadas y despacho de programadas vencidas. */
export const CAMPAIGN_SWEEP_INTERVAL_MS = 15_000;
/** Recuperación de entregas interrumpidas por una caída del worker. */
export const DELIVERY_RECOVERY_INTERVAL_MS = 60_000;
/** Caducidad de aprobaciones pendientes de campañas generadas por automatizaciones. */
export const APPROVAL_EXPIRY_INTERVAL_MS = 60_000;

export async function registerMaintenanceSchedulers(maintenanceQueue: Queue): Promise<void> {
  await maintenanceQueue.upsertJobScheduler(
    'maintenance-heartbeat',
    { every: HEARTBEAT_INTERVAL_MS },
    {
      name: MAINTENANCE_JOBS.heartbeat,
      opts: { removeOnComplete: true, removeOnFail: 100 },
    },
  );
  const sweeps: Array<[string, string, number]> = [
    ['maintenance-campaigns-due', MAINTENANCE_JOBS.campaignsDue, CAMPAIGN_SWEEP_INTERVAL_MS],
    [
      'maintenance-campaigns-complete',
      MAINTENANCE_JOBS.campaignsComplete,
      CAMPAIGN_SWEEP_INTERVAL_MS,
    ],
    [
      'maintenance-deliveries-recover',
      MAINTENANCE_JOBS.deliveriesRecover,
      DELIVERY_RECOVERY_INTERVAL_MS,
    ],
    ['maintenance-approvals-expire', MAINTENANCE_JOBS.approvalsExpire, APPROVAL_EXPIRY_INTERVAL_MS],
  ];
  for (const [id, name, every] of sweeps) {
    await maintenanceQueue.upsertJobScheduler(
      id,
      { every },
      { name, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }
}
