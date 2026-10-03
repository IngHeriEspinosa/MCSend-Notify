/**
 * Procesador de la cola de mantenimiento: latido del worker, barridos de campañas
 * (programadas vencidas, campañas terminadas y entregas interrumpidas) y caducidad de aprobaciones.
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

export interface CampaignSweeps {
  enqueueDue(): Promise<number>;
  completeFinished(): Promise<number>;
  recoverStale(): Promise<number>;
}

export interface ApprovalSweeps {
  expireDue(): Promise<number>;
}

export function createMaintenanceProcessor(
  heartbeat: Pick<WorkerHeartbeat, 'beat'>,
  campaigns?: CampaignSweeps,
  approvals?: ApprovalSweeps,
) {
  return async function processMaintenanceJob(job: Pick<Job, 'name'>): Promise<void> {
    switch (job.name) {
      case MAINTENANCE_JOBS.heartbeat:
        await heartbeat.beat();
        return;
      case MAINTENANCE_JOBS.campaignsDue:
        await campaigns?.enqueueDue();
        return;
      case MAINTENANCE_JOBS.campaignsComplete:
        await campaigns?.completeFinished();
        return;
      case MAINTENANCE_JOBS.deliveriesRecover:
        await campaigns?.recoverStale();
        return;
      case MAINTENANCE_JOBS.approvalsExpire:
        await approvals?.expireDue();
        return;
      default:
        throw new UnknownMaintenanceJobError(job.name);
    }
  };
}
