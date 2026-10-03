/**
 * Administración de la plataforma (solo SUPER_ADMIN): estado de las colas con los trabajos
 * fallidos (reintentar o descartar) y uso de IA del mes por tenant.
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import type { SessionUser } from '@/core/tenants/use-cases';

function assertPlatformAdmin(user: SessionUser): void {
  if (user.platformRole !== 'SUPER_ADMIN') {
    throw new DomainError('FORBIDDEN', 'Solo un administrador de plataforma');
  }
}

// ---------------------------------------------------------------------------
// Colas
// ---------------------------------------------------------------------------

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: boolean;
}

export interface FailedJobView {
  id: string;
  name: string;
  /** Tenant del job, si lo lleva (para localizar el problema). */
  tenantId: string | null;
  attemptsMade: number;
  failedReason: string;
  failedAt: Date | null;
}

export interface QueueAdmin {
  overview(): Promise<QueueCounts[]>;
  failed(queue: string, limit: number): Promise<FailedJobView[]>;
  /** Devuelve false si la cola o el job no existen (o el job ya no está fallido). */
  retry(queue: string, jobId: string): Promise<boolean>;
  remove(queue: string, jobId: string): Promise<boolean>;
}

export const queueJobSchema = z.object({
  queue: z.string().regex(/^[a-z-]{1,40}$/),
  jobId: z.string().min(1).max(200),
});
export type QueueJobInput = z.infer<typeof queueJobSchema>;

const FAILED_LISTED = 50;

export class ManageQueuesUseCase {
  constructor(private readonly deps: { queues: QueueAdmin; audit: AuditLogger }) {}

  async overview(user: SessionUser) {
    assertPlatformAdmin(user);
    return this.deps.queues.overview();
  }

  async failed(user: SessionUser, queue: string) {
    assertPlatformAdmin(user);
    return this.deps.queues.failed(queue, FAILED_LISTED);
  }

  async retry(user: SessionUser, input: QueueJobInput) {
    assertPlatformAdmin(user);
    if (!(await this.deps.queues.retry(input.queue, input.jobId))) {
      throw new DomainError('NOT_FOUND', 'Job inexistente o no fallido');
    }
    await this.audit(user, 'queue.job_retried', input);
  }

  async remove(user: SessionUser, input: QueueJobInput) {
    assertPlatformAdmin(user);
    if (!(await this.deps.queues.remove(input.queue, input.jobId))) {
      throw new DomainError('NOT_FOUND', 'Job inexistente');
    }
    await this.audit(user, 'queue.job_removed', input);
  }

  private audit(user: SessionUser, action: string, input: QueueJobInput) {
    return this.deps.audit.record(null, {
      action,
      entityType: 'queue_job',
      entityId: input.jobId,
      metadata: { queue: input.queue, by: user.id },
    });
  }
}

// ---------------------------------------------------------------------------
// Uso de IA por tenant
// ---------------------------------------------------------------------------

export interface TenantAiUsageRow {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  /** `PLATFORM` (clave de la plataforma), `OWN` (clave del tenant) o null si no configuró IA. */
  source: 'PLATFORM' | 'OWN' | null;
  monthlyBudgetUsd: number | null;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}

export interface PlatformAiUsageRepository {
  /** Uso agregado por tenant en [from, to), incluidos los tenants sin uso. */
  byTenant(from: Date, to: Date): Promise<TenantAiUsageRow[]>;
}

/** Mes `YYYY-MM` (UTC). */
export const usageMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .optional();

export interface PlatformAiUsageReport {
  month: string;
  rows: TenantAiUsageRow[];
  /** Coste cargado a la clave de la plataforma (tenants con `source = PLATFORM`). */
  platformCostMicros: number;
  totalCostMicros: number;
}

export class PlatformAiUsageUseCase {
  constructor(private readonly deps: { usage: PlatformAiUsageRepository; clock: Clock }) {}

  async month(user: SessionUser, month?: string): Promise<PlatformAiUsageReport> {
    assertPlatformAdmin(user);
    const now = this.deps.clock.now();
    const [year, monthIndex] = month
      ? month.split('-').map(Number)
      : [now.getUTCFullYear(), now.getUTCMonth() + 1];
    const from = new Date(Date.UTC(year ?? now.getUTCFullYear(), (monthIndex ?? 1) - 1, 1));
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const rows = (await this.deps.usage.byTenant(from, to)).sort(
      (a, b) => b.costMicros - a.costMicros || a.tenantName.localeCompare(b.tenantName),
    );
    return {
      month: from.toISOString().slice(0, 7),
      rows,
      platformCostMicros: rows
        .filter((row) => row.source === 'PLATFORM')
        .reduce((total, row) => total + row.costMicros, 0),
      totalCostMicros: rows.reduce((total, row) => total + row.costMicros, 0),
    };
  }
}
