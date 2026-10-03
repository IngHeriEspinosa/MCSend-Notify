/**
 * Ejecución de una automatización (worker):
 *
 *   reunir fuentes → redactar con IA → plantilla → campaña → aprobación (o programar) → avisar
 *
 * Idempotente y reanudable: la ejecución se registra con una clave única (fecha programada o id
 * manual) y guarda cada paso hecho (plantilla, campaña). Si el worker cae a mitad, el reintento
 * continúa desde el último paso sin crear plantillas ni campañas duplicadas.
 *
 * La IA solo redacta. Sin aprobación configurada, la campaña sale con la audiencia y el remitente
 * que una persona con permiso de envío fijó al crear la automatización.
 */
import { summarizeSources, type CollectedSource, type ContentCollector } from '@/core/ai/sources';
import type { AiAssistUseCase } from '@/core/ai/use-cases/ai-assist.use-cases';
import type { AuditLogger } from '@/core/audit/audit-log';
import type { CampaignRepository } from '@/core/campaigns/ports';
import type { ManageCampaignsUseCase } from '@/core/campaigns/use-cases/campaigns.use-cases';
import type { ChangelogRepository } from '@/core/changelog/changelog';
import type { SystemMailQueue } from '@/core/identity/system-mail';
import { isDomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { TemplateRepository } from '@/core/templates/ports';
import type { BrandingRepository } from '@/core/tenants/branding';
import { campaignPatchFor, type AutomationRecord, type AutomationRunRecord } from '../automation';
import type {
  AppLinks,
  ApprovalRepository,
  AutomationRepository,
  AutomationRunRepository,
  MemberDirectory,
} from '../ports';

export interface RunAutomationDeps {
  automations: AutomationRepository;
  runs: AutomationRunRepository;
  approvals: ApprovalRepository;
  collector: Pick<ContentCollector, 'collect'>;
  assist: Pick<AiAssistUseCase, 'draftFromSources'>;
  templates: Pick<TemplateRepository, 'create' | 'findById'>;
  campaignRepo: Pick<CampaignRepository, 'create'>;
  campaigns: Pick<ManageCampaignsUseCase, 'submitForApproval' | 'scheduleAutomated' | 'checks'>;
  changelog: Pick<ChangelogRepository, 'markConsumed'>;
  members: MemberDirectory;
  mail: SystemMailQueue;
  links: AppLinks;
  branding: Pick<BrandingRepository, 'getEmailProfile'>;
  audit: AuditLogger;
  clock: Clock;
}

/** Errores de dominio transitorios: el job se reintenta en lugar de marcar la ejecución fallida. */
const RETRYABLE_REASONS = new Set(['AI_UNAVAILABLE', 'AI_PROVIDER_BUSY']);

export interface RunOptions {
  trigger: 'schedule' | 'manual';
  finalAttempt: boolean;
}

export class RunAutomationUseCase {
  constructor(private readonly deps: RunAutomationDeps) {}

  async execute(
    context: TenantContext,
    automationId: string,
    idempotencyKey: string,
    options: RunOptions,
  ): Promise<AutomationRunRecord | null> {
    const automation = await this.deps.automations.findById(context, automationId);
    if (!automation) return null;
    if (options.trigger === 'schedule' && !automation.enabled) return null;

    const { run } = await this.deps.runs.start(context, {
      automationId,
      idempotencyKey,
      trigger: options.trigger,
    });
    if (run.status !== 'RUNNING') return run;

    try {
      await this.process(context, automation, run);
    } catch (error) {
      const reason = isDomainError(error)
        ? String(error.details?.reason ?? error.code)
        : 'UNEXPECTED';
      const retryable = !isDomainError(error) || RETRYABLE_REASONS.has(reason);
      if (retryable && !options.finalAttempt) throw error;
      await this.deps.runs.transition(context, run.id, ['RUNNING'], {
        status: 'FAILED',
        error: reason,
        finishedAt: this.deps.clock.now(),
      });
      await this.deps.audit.record(context, {
        action: 'automation.run_failed',
        entityType: 'automation',
        entityId: automationId,
        metadata: { runId: run.id, reason },
      });
    }
    await this.deps.automations.setLastRun(context, automationId, this.deps.clock.now());
    return this.deps.runs.findById(context, run.id);
  }

  private async process(
    context: TenantContext,
    automation: AutomationRecord,
    run: AutomationRunRecord,
  ): Promise<void> {
    const { definition } = automation;
    const now = this.deps.clock.now();
    const label = `${automation.name} · ${now.toISOString().slice(0, 10)} · ${run.id.slice(-6)}`;

    let templateId = run.templateId;
    let campaignId = run.campaignId;
    let changelogIds: string[] = [];

    if (!templateId) {
      const { sources, changelogIds: ids } = await this.deps.collector.collect(
        context,
        definition.sources,
      );
      changelogIds = ids;
      if (this.shouldSkip(automation, sources, ids)) {
        await this.deps.runs.transition(context, run.id, ['RUNNING'], {
          status: 'SKIPPED',
          sources: summarizeSources(sources),
          finishedAt: now,
        });
        return;
      }
      const draft = await this.deps.assist.draftFromSources(context, sources, {
        instructions: definition.instructions,
        tone: definition.tone,
        locale: definition.locale,
      });
      const template = await this.deps.templates.create(context, {
        name: label,
        description: `IA · ${automation.name}`,
        body: draft.body,
        note: `Automatización ${automation.name}`,
        userId: automation.createdById,
      });
      templateId = template.id;
      await this.deps.runs.update(context, run.id, {
        templateId,
        sources: draft.sources,
        removedLinks: draft.removedLinks,
      });
    }

    if (!campaignId) {
      const campaign = await this.deps.campaignRepo.create(context, {
        name: label,
        templateId,
        senderIdentityId: definition.senderIdentityId,
        createdById: automation.createdById,
        copyFrom: campaignPatchFor(definition, templateId, label),
      });
      campaignId = campaign.id;
      await this.deps.runs.update(context, run.id, { campaignId });
      if (changelogIds.length > 0) {
        await this.deps.changelog.markConsumed(context, changelogIds, run.id, now);
      }
    }

    if (!definition.requiresApproval) {
      await this.deps.campaigns.scheduleAutomated(context, campaignId);
      await this.deps.runs.transition(context, run.id, ['RUNNING'], {
        status: 'SCHEDULED',
        finishedAt: this.deps.clock.now(),
      });
      return;
    }

    await this.deps.campaigns.submitForApproval(context, campaignId);
    const approval = await this.deps.approvals.create(context, {
      runId: run.id,
      campaignId,
      approverUserIds: definition.approverUserIds,
      onTimeout: definition.onTimeout,
      expiresAt: new Date(now.getTime() + definition.approvalTimeoutHours * 3_600_000),
    });
    await this.deps.runs.transition(context, run.id, ['RUNNING'], { status: 'AWAITING_APPROVAL' });
    await this.notifyApprovers(context, automation, approval.id, approval.expiresAt, {
      campaignId,
      templateId,
    });
  }

  /** Sin novedades nuevas no se genera un correo vacío o repetido. */
  private shouldSkip(
    automation: AutomationRecord,
    sources: readonly CollectedSource[],
    changelogIds: readonly string[],
  ): boolean {
    if (sources.length === 0) return true;
    const usesChangelog = automation.definition.sources.some(
      (source) => source.kind === 'changelog',
    );
    return automation.definition.skipWhenNoNews && usesChangelog && changelogIds.length === 0;
  }

  private async notifyApprovers(
    context: TenantContext,
    automation: AutomationRecord,
    approvalId: string,
    expiresAt: Date,
    ids: { campaignId: string; templateId: string },
  ): Promise<void> {
    const [members, profile, checks, template] = await Promise.all([
      this.deps.members.findMembers(context, automation.definition.approverUserIds),
      this.deps.branding.getEmailProfile(context),
      this.deps.campaigns.checks(context, ids.campaignId),
      this.deps.templates.findById(context, ids.templateId),
    ]);
    for (const member of members) {
      await this.deps.mail.enqueue({
        kind: 'approval-request',
        to: member.email,
        locale: member.locale,
        tenantName: profile.name,
        automationName: automation.name,
        subject: template?.body.subject ?? automation.name,
        recipients: checks.recipients,
        url: this.deps.links.approvalUrl(context, approvalId, member.locale),
        expiresAt,
      });
    }
  }
}
