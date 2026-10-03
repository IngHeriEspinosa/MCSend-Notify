/**
 * Aprobación humana de campañas generadas por automatizaciones.
 *
 * - Deciden los aprobadores designados o, en su defecto, propietarios y administradores; siempre
 *   con permiso de envío y con sesión (la decisión es una Server Action POST, nunca un enlace GET:
 *   los escáneres de enlaces del correo no pueden aprobar nada).
 * - Aprobar congela la versión de la plantilla que vio quien aprueba y programa el envío.
 * - Rechazar devuelve la campaña a borrador para editarla o descartarla.
 * - Al caducar se aplica la acción configurada: cancelar (por defecto) o enviar.
 *
 * Concurrencia: la transición de la campaña (CAS sobre su estado) es siempre el primer paso y la
 * única fuente de verdad. Si dos personas deciden a la vez, o una decide mientras caduca, quien
 * pierde recibe un error antes de registrar su decisión.
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import type { CampaignRecord } from '@/core/campaigns/campaign';
import type { ManageCampaignsUseCase } from '@/core/campaigns/use-cases/campaigns.use-cases';
import { assertCan, can } from '@/core/identity/permissions';
import { DomainError, isDomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import { systemContext, type TenantContext } from '@/core/shared/tenant-context';
import type { TemplateRepository } from '@/core/templates/ports';
import type { ApprovalRecord, ApprovalStatus } from '../automation';
import type { ApprovalRepository, AutomationRunRepository } from '../ports';

export const approveSchema = z.object({
  approvalId: z.uuid(),
  campaignVersion: z.number().int().min(1),
  templateVersion: z.number().int().min(1),
  comment: z.string().trim().max(500).default(''),
});

export const rejectSchema = z.object({
  approvalId: z.uuid(),
  comment: z.string().trim().max(500).default(''),
});

export interface ApprovalUseCaseDeps {
  approvals: ApprovalRepository;
  runs: Pick<AutomationRunRepository, 'transition' | 'findById'>;
  campaigns: Pick<
    ManageCampaignsUseCase,
    'get' | 'approve' | 'returnToDraft' | 'expirePendingApproval' | 'checks'
  >;
  templates: Pick<TemplateRepository, 'findById'>;
  audit: AuditLogger;
  clock: Clock;
}

export interface ApprovalDetail {
  approval: ApprovalRecord;
  campaign: CampaignRecord;
  templateVersion: number | null;
  recipients: number;
  blocking: boolean;
  canDecide: boolean;
  /** Enlaces que la IA propuso y los guardrails eliminaron: indicio de contenido a revisar. */
  removedLinks: string[];
}

export class ApprovalsUseCase {
  constructor(private readonly deps: ApprovalUseCaseDeps) {}

  list(context: TenantContext, status: ApprovalStatus | null) {
    assertCan(context, 'campaign:read');
    return this.deps.approvals.list(context, status, 100);
  }

  countPending(context: TenantContext) {
    assertCan(context, 'campaign:read');
    return this.deps.approvals.countPending(context);
  }

  async get(context: TenantContext, approvalId: string): Promise<ApprovalDetail> {
    assertCan(context, 'campaign:read');
    const approval = await this.find(context, approvalId);
    const campaign = await this.deps.campaigns.get(context, approval.campaignId);
    const template = campaign.templateId
      ? await this.deps.templates.findById(context, campaign.templateId)
      : null;
    const [checks, run] = await Promise.all([
      campaign.status === 'PENDING_APPROVAL'
        ? this.deps.campaigns.checks(context, campaign.id)
        : null,
      this.deps.runs.findById(context, approval.runId),
    ]);
    return {
      approval,
      campaign,
      templateVersion: template?.currentVersion ?? null,
      recipients: checks?.recipients ?? campaign.recipientCount,
      blocking: checks?.issues.some((issue) => issue.severity === 'error') ?? false,
      canDecide: approval.status === 'PENDING' && this.canDecide(context, approval),
      removedLinks: run?.removedLinks ?? [],
    };
  }

  async approve(context: TenantContext, input: z.infer<typeof approveSchema>) {
    const approval = await this.pending(context, input.approvalId);
    await this.deps.campaigns.approve(context, approval.campaignId, {
      campaignVersion: input.campaignVersion,
      templateVersion: input.templateVersion,
    });
    await this.close(context, approval, 'APPROVED', input.comment, 'SCHEDULED');
  }

  async reject(context: TenantContext, input: z.infer<typeof rejectSchema>) {
    const approval = await this.pending(context, input.approvalId);
    await this.deps.campaigns.returnToDraft(context, approval.campaignId);
    await this.decide(context, approval, 'REJECTED', input.comment);
    await this.finishRun(context, approval, 'REJECTED');
  }

  /** Barrido del worker: aplica la acción de caducidad a las aprobaciones vencidas. */
  async expireDue(): Promise<number> {
    const expired = await this.deps.approvals.findExpired(this.deps.clock.now(), 100);
    for (const ref of expired) {
      const context = systemContext(ref.tenantId, ref.tenantSlug, 'approval-expiry');
      const approval = await this.deps.approvals.findById(context, ref.id);
      if (!approval || approval.status !== 'PENDING') continue;
      if (approval.onTimeout === 'send' && (await this.sendOnTimeout(context, approval))) continue;
      try {
        await this.deps.campaigns.expirePendingApproval(context, approval.campaignId);
      } catch (error) {
        // Otra persona decidió justo antes: su decisión prevalece.
        if (isDomainError(error) && error.code === 'INVALID_STATE') continue;
        throw error;
      }
      await this.decide(context, approval, 'EXPIRED', '');
      await this.finishRun(context, approval, 'EXPIRED');
    }
    return expired.length;
  }

  /** Envío automático al caducar; si la campaña ya no se puede programar, se cancela. */
  private async sendOnTimeout(context: TenantContext, approval: ApprovalRecord): Promise<boolean> {
    try {
      const campaign = await this.deps.campaigns.get(context, approval.campaignId);
      const template = campaign.templateId
        ? await this.deps.templates.findById(context, campaign.templateId)
        : null;
      if (!template) return false;
      await this.deps.campaigns.approve(context, approval.campaignId, {
        campaignVersion: campaign.version,
        templateVersion: template.currentVersion,
      });
      await this.close(context, approval, 'APPROVED', '', 'SCHEDULED');
      return true;
    } catch (error) {
      if (isDomainError(error)) return false;
      throw error;
    }
  }

  private async close(
    context: TenantContext,
    approval: ApprovalRecord,
    status: 'APPROVED',
    comment: string,
    runStatus: 'SCHEDULED',
  ) {
    await this.decide(context, approval, status, comment);
    await this.finishRun(context, approval, runStatus);
  }

  private async decide(
    context: TenantContext,
    approval: ApprovalRecord,
    status: Exclude<ApprovalStatus, 'PENDING'>,
    comment: string,
  ): Promise<boolean> {
    const decidedById = context.actor.type === 'user' ? context.actor.userId : null;
    const decided = await this.deps.approvals.decide(context, approval.id, {
      status,
      decidedById,
      comment: comment || null,
      at: this.deps.clock.now(),
    });
    if (decided) {
      await this.deps.audit.record(context, {
        action: `approval.${status.toLowerCase()}`,
        entityType: 'approval',
        entityId: approval.id,
        metadata: { campaignId: approval.campaignId, automationId: approval.automationId },
      });
    }
    return decided;
  }

  private finishRun(
    context: TenantContext,
    approval: ApprovalRecord,
    status: 'SCHEDULED' | 'REJECTED' | 'EXPIRED',
  ) {
    return this.deps.runs.transition(context, approval.runId, ['AWAITING_APPROVAL'], {
      status,
      finishedAt: this.deps.clock.now(),
    });
  }

  private async find(context: TenantContext, approvalId: string): Promise<ApprovalRecord> {
    const approval = await this.deps.approvals.findById(context, approvalId);
    if (!approval) throw new DomainError('NOT_FOUND', 'Aprobación inexistente');
    return approval;
  }

  /** Aprobación pendiente, vigente y que el actor puede decidir. */
  private async pending(context: TenantContext, approvalId: string): Promise<ApprovalRecord> {
    assertCan(context, 'campaign:send');
    const approval = await this.find(context, approvalId);
    if (!this.canDecide(context, approval)) {
      throw new DomainError('FORBIDDEN', 'No eres aprobador de esta campaña', {
        reason: 'NOT_APPROVER',
      });
    }
    if (approval.status !== 'PENDING') {
      throw new DomainError('INVALID_STATE', 'La aprobación ya se decidió', {
        reason: 'APPROVAL_DECIDED',
      });
    }
    if (approval.expiresAt.getTime() <= this.deps.clock.now().getTime()) {
      throw new DomainError('EXPIRED', 'La aprobación caducó');
    }
    return approval;
  }

  private canDecide(context: TenantContext, approval: ApprovalRecord): boolean {
    const { actor } = context;
    if (actor.type === 'system') return true;
    if (actor.type !== 'user' || !can(actor, 'campaign:send')) return false;
    return (
      approval.approverUserIds.includes(actor.userId) ||
      actor.role === 'OWNER' ||
      actor.role === 'ADMIN'
    );
  }
}
