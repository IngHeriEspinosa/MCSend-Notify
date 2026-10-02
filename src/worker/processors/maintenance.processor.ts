/**
 * Procesador de la cola de mantenimiento. En la Fase 0 solo registra el latido del worker;
 * en fases posteriores incorporará barridos de campañas programadas, volcado de métricas,
 * retención de datos y expiración de aprobaciones.
 */
import type { Job } from 'bullmq';
import type { WorkerHeartbeat } from '@/infrastructure/observability/worker-heartbeat';
import { MAINTENANCE_JOBS } from '@/infrastructure/queue/queue-names';

export class UnknownMaintenanceJobError extends Error {
  constructor(jobName: string) {
    super(`Job de mantenimiento desconocido: ${jobName}`);
    this.name = 'UnknownMaintenanceJobError';
  }
}

export function createMaintenanceProcessor(heartbeat: Pick<WorkerHeartbeat, 'beat'>) {
  return async function processMaintenanceJob(job: Pick<Job, 'name'>): Promise<void> {
    switch (job.name) {
      case MAINTENANCE_JOBS.heartbeat:
        await heartbeat.beat();
        return;
      default:
        throw new UnknownMaintenanceJobError(job.name);
    }
  };
}
