/** Puertos de automatizaciones, ejecuciones, aprobaciones y su programación en la cola. */
import type { SourceSummary } from '@/core/ai/sources';
import type { MembershipRole } from '@/core/identity/roles';
import type { TenantContext } from '@/core/shared/tenant-context';
import type {
  ApprovalRecord,
  ApprovalStatus,
  AutomationDefinition,
  AutomationRecord,
  AutomationRunRecord,
  AutomationRunStatus,
  AutomationSchedule,
  AutomationSummary,
  OnTimeoutAction,
} from './automation';

export interface AutomationWrite {
  name: string;
  schedule: AutomationSchedule;
  timezone: string;
  definition: AutomationDefinition;
}

/** Referencia global (con el tenant) para el worker. */
export interface AutomationRef {
  id: string;
  tenantId: string;
  tenantSlug: string;
  schedule: AutomationSchedule;
  timezone: string;
}

export interface AutomationRepository {
  list(context: TenantContext): Promise<AutomationSummary[]>;
  findById(context: TenantContext, automationId: string): Promise<AutomationRecord | null>;
  create(
    context: TenantContext,
    input: AutomationWrite & { createdById: string },
  ): Promise<AutomationRecord>;
  update(
    context: TenantContext,
    automationId: string,
    input: AutomationWrite,
  ): Promise<AutomationRecord>;
  setEnabled(context: TenantContext, automationId: string, enabled: boolean): Promise<boolean>;
  setLastRun(context: TenantContext, automationId: string, at: Date): Promise<void>;
  delete(context: TenantContext, automationId: string): Promise<boolean>;
  /** Automatizaciones activas de todos los tenants (sincronizar la programación al arrancar). */
  listEnabled(): Promise<AutomationRef[]>;
}

export interface RunPatch {
  status?: AutomationRunStatus;
  campaignId?: string | null;
  templateId?: string | null;
  sources?: SourceSummary[];
  removedLinks?: string[];
  error?: string | null;
  finishedAt?: Date | null;
}

export interface AutomationRunRepository {
  /**
   * Registra el inicio de una ejecución. Si ya existe una con la misma clave de idempotencia,
   * devuelve la existente con `created: false` (un job repetido no ejecuta dos veces).
   */
  start(
    context: TenantContext,
    input: { automationId: string; idempotencyKey: string; trigger: 'schedule' | 'manual' },
  ): Promise<{ run: AutomationRunRecord; created: boolean }>;
  /** Vuelve a RUNNING una ejecución FAILED para reintentarla (mismo id). */
  restart(context: TenantContext, runId: string): Promise<boolean>;
  update(context: TenantContext, runId: string, patch: RunPatch): Promise<void>;
  /** Cambio de estado atómico (solo si está en `from`). */
  transition(
    context: TenantContext,
    runId: string,
    from: readonly AutomationRunStatus[],
    patch: RunPatch & { status: AutomationRunStatus },
  ): Promise<boolean>;
  findById(context: TenantContext, runId: string): Promise<AutomationRunRecord | null>;
  list(context: TenantContext, automationId: string, limit: number): Promise<AutomationRunRecord[]>;
}

export interface ApprovalRepository {
  create(
    context: TenantContext,
    input: {
      runId: string;
      campaignId: string;
      approverUserIds: string[];
      onTimeout: OnTimeoutAction;
      expiresAt: Date;
    },
  ): Promise<ApprovalRecord>;
  findById(context: TenantContext, approvalId: string): Promise<ApprovalRecord | null>;
  list(
    context: TenantContext,
    status: ApprovalStatus | null,
    limit: number,
  ): Promise<ApprovalRecord[]>;
  countPending(context: TenantContext): Promise<number>;
  /** Decide solo si sigue PENDING (dos personas a la vez: solo una gana). */
  decide(
    context: TenantContext,
    approvalId: string,
    decision: {
      status: Exclude<ApprovalStatus, 'PENDING'>;
      decidedById: string | null;
      comment: string | null;
      at: Date;
    },
  ): Promise<boolean>;
  /** Pendientes caducadas de todos los tenants. */
  findExpired(
    now: Date,
    limit: number,
  ): Promise<Array<{ id: string; tenantId: string; tenantSlug: string }>>;
}

/** Programación de las automatizaciones en la cola (BullMQ Job Schedulers). */
export interface AutomationScheduler {
  /** Crea o actualiza la programación (idempotente). */
  upsert(ref: AutomationRef): Promise<void>;
  remove(automationId: string): Promise<void>;
  /** Ejecución inmediata ("Ejecutar ahora") o reintento. */
  enqueueRun(
    context: TenantContext,
    automationId: string,
    idempotencyKey: string,
    trigger: 'schedule' | 'manual',
  ): Promise<void>;
}

export interface TenantMemberContact {
  userId: string;
  email: string;
  name: string | null;
  locale: 'es' | 'en';
  role: MembershipRole;
}

/** Miembros del tenant para validar aprobadores y avisarles por correo. */
export interface MemberDirectory {
  findMembers(context: TenantContext, userIds: readonly string[]): Promise<TenantMemberContact[]>;
}

/** URL absolutas de la app para los correos (la base la da la infraestructura). */
export interface AppLinks {
  approvalUrl(context: TenantContext, approvalId: string, locale: 'es' | 'en'): string;
}
