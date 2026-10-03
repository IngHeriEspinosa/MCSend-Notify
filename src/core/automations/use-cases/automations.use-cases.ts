/**
 * Gestión de automatizaciones: alta, edición, activación (programa la cola), eliminación,
 * ejecución manual e historial de ejecuciones.
 *
 * Una automatización envía correos masivos en nombre del tenant: quien la crea, edita o activa
 * necesita el permiso de envío de campañas, y los aprobadores deben ser miembros que lo tengan.
 */
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan, ROLE_PERMISSIONS } from '@/core/identity/permissions';
import type { SenderRepository } from '@/core/providers/ports';
import { DomainError } from '@/core/shared/domain-error';
import type { IdGenerator } from '@/core/shared/ports';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import type { AutomationInput, AutomationRecord } from '../automation';
import type {
  AutomationRepository,
  AutomationRunRepository,
  AutomationScheduler,
  MemberDirectory,
} from '../ports';

export interface AutomationUseCaseDeps {
  automations: AutomationRepository;
  runs: AutomationRunRepository;
  scheduler: AutomationScheduler;
  members: MemberDirectory;
  senders: Pick<SenderRepository, 'findById'>;
  audit: AuditLogger;
  ids: IdGenerator;
}

export const MAX_RUNS_LISTED = 50;

export class ManageAutomationsUseCase {
  constructor(private readonly deps: AutomationUseCaseDeps) {}

  list(context: TenantContext) {
    assertCan(context, 'automation:read');
    return this.deps.automations.list(context);
  }

  async get(context: TenantContext, automationId: string): Promise<AutomationRecord> {
    assertCan(context, 'automation:read');
    const automation = await this.deps.automations.findById(context, automationId);
    if (!automation) throw new DomainError('NOT_FOUND', 'Automatización inexistente');
    return automation;
  }

  async runs(context: TenantContext, automationId: string) {
    await this.get(context, automationId);
    return this.deps.runs.list(context, automationId, MAX_RUNS_LISTED);
  }

  async create(context: TenantContext, input: AutomationInput) {
    this.assertCanManage(context);
    const userId = actorUserId(context);
    if (!userId) throw new DomainError('FORBIDDEN', 'Solo un usuario crea automatizaciones');
    await this.validate(context, input);
    const automation = await this.deps.automations.create(context, {
      ...input,
      createdById: userId,
    });
    await this.deps.audit.record(context, {
      action: 'automation.created',
      entityType: 'automation',
      entityId: automation.id,
      metadata: {
        frequency: input.schedule.frequency,
        requiresApproval: input.definition.requiresApproval,
      },
    });
    return automation;
  }

  async update(context: TenantContext, automationId: string, input: AutomationInput) {
    this.assertCanManage(context);
    await this.get(context, automationId);
    await this.validate(context, input);
    const automation = await this.deps.automations.update(context, automationId, input);
    if (automation.enabled) await this.deps.scheduler.upsert(this.ref(context, automation));
    await this.deps.audit.record(context, {
      action: 'automation.updated',
      entityType: 'automation',
      entityId: automationId,
      metadata: { requiresApproval: input.definition.requiresApproval },
    });
    return automation;
  }

  async setEnabled(context: TenantContext, automationId: string, enabled: boolean) {
    this.assertCanManage(context);
    const automation = await this.get(context, automationId);
    if (enabled) await this.validate(context, automation);
    await this.deps.automations.setEnabled(context, automationId, enabled);
    if (enabled) {
      await this.deps.scheduler.upsert(this.ref(context, automation));
    } else {
      await this.deps.scheduler.remove(automationId);
    }
    await this.deps.audit.record(context, {
      action: enabled ? 'automation.enabled' : 'automation.disabled',
      entityType: 'automation',
      entityId: automationId,
    });
  }

  async delete(context: TenantContext, automationId: string) {
    this.assertCanManage(context);
    await this.deps.scheduler.remove(automationId);
    if (!(await this.deps.automations.delete(context, automationId))) {
      throw new DomainError('NOT_FOUND', 'Automatización inexistente');
    }
    await this.deps.audit.record(context, {
      action: 'automation.deleted',
      entityType: 'automation',
      entityId: automationId,
    });
  }

  /** "Ejecutar ahora": encola una ejecución con su propia clave de idempotencia. */
  async runNow(context: TenantContext, automationId: string) {
    this.assertCanManage(context);
    assertCan(context, 'ai:use');
    const automation = await this.get(context, automationId);
    await this.validate(context, automation);
    const key = `manual-${this.deps.ids.uuid()}`;
    await this.deps.scheduler.enqueueRun(context, automationId, key, 'manual');
    await this.deps.audit.record(context, {
      action: 'automation.run_requested',
      entityType: 'automation',
      entityId: automationId,
    });
    return { idempotencyKey: key };
  }

  /** Reprograma en la cola todas las automatizaciones activas (arranque del worker). */
  async syncSchedules(): Promise<number> {
    const enabled = await this.deps.automations.listEnabled();
    for (const automation of enabled) await this.deps.scheduler.upsert(automation);
    return enabled.length;
  }

  private assertCanManage(context: TenantContext) {
    assertCan(context, 'automation:write');
    assertCan(context, 'campaign:send');
  }

  private ref(context: TenantContext, automation: AutomationRecord) {
    return {
      id: automation.id,
      tenantId: context.tenantId,
      tenantSlug: context.tenantSlug,
      schedule: automation.schedule,
      timezone: automation.timezone,
    };
  }

  /** Remitente del tenant y aprobadores que existen y pueden enviar campañas. */
  private async validate(
    context: TenantContext,
    input: Pick<AutomationInput, 'definition'>,
  ): Promise<void> {
    const { definition } = input;
    if (!(await this.deps.senders.findById(context, definition.senderIdentityId))) {
      throw new DomainError('VALIDATION', 'Remitente inexistente', {
        field: 'senderIdentityId',
        reason: 'SENDER_MISSING',
      });
    }
    if (definition.audience.listIds.length === 0 && definition.audience.segmentIds.length === 0) {
      throw new DomainError('VALIDATION', 'La audiencia está vacía', {
        field: 'audience',
        reason: 'NO_RECIPIENTS',
      });
    }
    if (!definition.requiresApproval) return;
    const members = await this.deps.members.findMembers(context, definition.approverUserIds);
    const valid = new Set(
      members
        .filter((member) => ROLE_PERMISSIONS[member.role].has('campaign:send'))
        .map((member) => member.userId),
    );
    if (definition.approverUserIds.some((userId) => !valid.has(userId))) {
      throw new DomainError('VALIDATION', 'Aprobador no válido', {
        field: 'approverUserIds',
        reason: 'INVALID_APPROVER',
      });
    }
  }
}
