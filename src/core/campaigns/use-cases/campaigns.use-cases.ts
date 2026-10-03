/**
 * Gestión de campañas: borrador, comprobaciones previas, vista previa, envío de prueba,
 * programación, pausa, reanudación, cancelación e informes.
 *
 * El contenido se toma de la plantilla vigente mientras la campaña es un borrador y se congela
 * (copia del cuerpo y versión de la plantilla) al programarla.
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import type {
  ContactListRepository,
  ContactRepository,
  SegmentRepository,
  TopicRepository,
} from '@/core/contacts/ports';
import { assertCan } from '@/core/identity/permissions';
import { isDnsHealthy, senderDomain } from '@/core/providers/provider-config';
import type {
  EmailProviderGateway,
  ProviderConfigRepository,
  SenderRepository,
} from '@/core/providers/ports';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import type { TemplateBody } from '@/core/templates/email-content';
import { hasLiquidSyntaxError, type EmailComposer } from '@/core/templates/email-composer';
import type { EmailCompiler, TemplateRepository } from '@/core/templates/ports';
import { hasBlockingIssues } from '@/core/templates/template-issues';
import { buildRecipientVariables, SAMPLE_RECIPIENT } from '@/core/templates/template-variables';
import { PREVIEW_LINKS } from '@/core/templates/use-cases/templates.use-cases';
import {
  SEND_CONFIRMATION_THRESHOLD,
  type CampaignIssue,
  type CampaignRecord,
  type CampaignAudience,
  type UpdateCampaignInput,
} from '../campaign';
import type { DeliveryStatus } from '../delivery';
import type {
  AudienceResolver,
  CampaignQueue,
  CampaignRepository,
  DeliveryRepository,
} from '../ports';

export interface CampaignUseCaseDeps {
  campaigns: CampaignRepository;
  deliveries: DeliveryRepository;
  audience: AudienceResolver;
  queue: CampaignQueue;
  templates: TemplateRepository;
  senders: SenderRepository;
  providers: ProviderConfigRepository;
  gateway: EmailProviderGateway;
  composer: EmailComposer;
  compiler: EmailCompiler;
  contacts: Pick<ContactRepository, 'findById'>;
  lists: Pick<ContactListRepository, 'countExisting'>;
  segments: Pick<SegmentRepository, 'findById'>;
  topics: Pick<TopicRepository, 'countExisting'>;
  audit: AuditLogger;
  clock: Clock;
}

export const campaignPreviewSchema = z.object({
  campaignId: z.uuid(),
  contactId: z.uuid().nullable(),
  colorScheme: z.enum(['light', 'dark']).default('light'),
  variant: z.enum(['A', 'B']).default('A'),
});

export const audienceCountSchema = z.object({
  audience: z.object({
    listIds: z.array(z.uuid()).max(50),
    segmentIds: z.array(z.uuid()).max(50),
    excludeListIds: z.array(z.uuid()).max(50),
  }),
  topicId: z.uuid().nullable(),
});

const RESUME_BATCH = 1000;

function requireUser(context: TenantContext): string {
  const userId = actorUserId(context);
  if (!userId) throw new DomainError('FORBIDDEN', 'Acción reservada a usuarios');
  return userId;
}

export class ManageCampaignsUseCase {
  constructor(private readonly deps: CampaignUseCaseDeps) {}

  list(context: TenantContext) {
    assertCan(context, 'campaign:read');
    return this.deps.campaigns.list(context);
  }

  async get(context: TenantContext, campaignId: string): Promise<CampaignRecord> {
    assertCan(context, 'campaign:read');
    const campaign = await this.deps.campaigns.findById(context, campaignId);
    if (!campaign) throw new DomainError('NOT_FOUND', 'Campaña inexistente');
    return campaign;
  }

  async create(context: TenantContext, input: { name: string; templateId: string }) {
    assertCan(context, 'campaign:write');
    if (!(await this.deps.templates.findById(context, input.templateId))) {
      throw new DomainError('VALIDATION', 'Plantilla inválida', { field: 'templateId' });
    }
    const senders = await this.deps.senders.list(context);
    const campaign = await this.deps.campaigns.create(context, {
      name: input.name,
      templateId: input.templateId,
      senderIdentityId: (senders.find((sender) => sender.isDefault) ?? senders[0])?.id ?? null,
      createdById: requireUser(context),
    });
    await this.deps.audit.record(context, {
      action: 'campaign.created',
      entityType: 'campaign',
      entityId: campaign.id,
    });
    return campaign;
  }

  async update(context: TenantContext, input: UpdateCampaignInput) {
    assertCan(context, 'campaign:write');
    const current = await this.get(context, input.campaignId);
    if (current.status !== 'DRAFT') {
      throw new DomainError('INVALID_STATE', 'Solo se editan campañas en borrador');
    }
    await this.assertReferences(context, input);
    const { campaignId, expectedVersion, ...patch } = input;
    const updated = await this.deps.campaigns.updateDraft(
      context,
      campaignId,
      expectedVersion,
      patch,
    );
    if (!updated) {
      throw new DomainError('CONFLICT', 'La campaña cambió mientras se editaba', {
        reason: 'STALE_VERSION',
      });
    }
    return updated;
  }

  async duplicate(context: TenantContext, campaignId: string, name: string) {
    assertCan(context, 'campaign:write');
    const source = await this.get(context, campaignId);
    if (!source.templateId) throw new DomainError('INVALID_STATE', 'La campaña no tiene plantilla');
    const copy = await this.deps.campaigns.create(context, {
      name,
      templateId: source.templateId,
      senderIdentityId: source.senderIdentityId,
      createdById: requireUser(context),
      copyFrom: {
        name,
        templateId: source.templateId,
        audience: source.audience,
        topicId: source.topicId,
        senderIdentityId: source.senderIdentityId,
        subjectB: source.subjectB,
        trackOpens: source.trackOpens,
        trackClicks: source.trackClicks,
        throttlePerHour: source.throttlePerHour,
      },
    });
    await this.deps.audit.record(context, {
      action: 'campaign.duplicated',
      entityType: 'campaign',
      entityId: copy.id,
      metadata: { from: campaignId },
    });
    return copy;
  }

  async delete(context: TenantContext, campaignId: string) {
    assertCan(context, 'campaign:write');
    const campaign = await this.get(context, campaignId);
    if (!['DRAFT', 'CANCELLED', 'FAILED'].includes(campaign.status)) {
      throw new DomainError('INVALID_STATE', 'Solo se eliminan borradores o campañas canceladas');
    }
    await this.deps.campaigns.delete(context, campaignId);
    await this.deps.audit.record(context, {
      action: 'campaign.deleted',
      entityType: 'campaign',
      entityId: campaignId,
    });
  }

  countAudience(context: TenantContext, audience: CampaignAudience, topicId: string | null) {
    assertCan(context, 'campaign:read');
    return this.deps.audience.count(context, audience, topicId);
  }

  /** Comprobaciones previas: contenido, remitente, DNS, proveedor y destinatarios. */
  async checks(context: TenantContext, campaignId: string) {
    const campaign = await this.get(context, campaignId);
    return this.runChecks(context, campaign);
  }

  async preview(context: TenantContext, input: z.infer<typeof campaignPreviewSchema>) {
    const campaign = await this.get(context, input.campaignId);
    const body = await this.bodyFor(context, campaign);
    if (!body) throw new DomainError('NOT_FOUND', 'Plantilla inexistente');
    const subject = input.variant === 'B' && campaign.subjectB ? campaign.subjectB : body.subject;
    const { prepared, tenantName } = await this.deps.composer.prepare(
      context,
      { ...body, subject },
      { forceColorScheme: input.colorScheme },
    );
    if (hasLiquidSyntaxError(prepared)) {
      return { subject: prepared.subject, html: prepared.html, issues: prepared.issues };
    }
    let recipient = SAMPLE_RECIPIENT;
    if (input.contactId) {
      assertCan(context, 'contact:read');
      const contact = await this.deps.contacts.findById(context, input.contactId);
      if (!contact) throw new DomainError('NOT_FOUND', 'Contacto inexistente');
      recipient = contact;
    }
    const rendered = await this.deps.compiler.personalize(
      prepared,
      buildRecipientVariables({
        recipient,
        tenantName,
        links: PREVIEW_LINKS,
        now: this.deps.clock.now(),
      }),
    );
    return { subject: rendered.subject, html: rendered.html, issues: prepared.issues };
  }

  /** Envía la campaña a direcciones de prueba (sin seguimiento ni registro de entregas). */
  async sendTest(context: TenantContext, input: { campaignId: string; emails: string[] }) {
    assertCan(context, 'campaign:write');
    const campaign = await this.get(context, input.campaignId);
    const body = await this.bodyFor(context, campaign);
    if (!body) throw new DomainError('NOT_FOUND', 'Plantilla inexistente');
    const sender = campaign.senderIdentityId
      ? await this.deps.senders.findById(context, campaign.senderIdentityId)
      : null;
    if (!sender)
      throw new DomainError('VALIDATION', 'Falta el remitente', { reason: 'SENDER_MISSING' });
    const gateway = await this.deps.gateway.forProvider(context, sender.providerConfigId);
    if (!gateway)
      throw new DomainError('INVALID_STATE', 'Proveedor no disponible', {
        reason: 'PROVIDER_ERROR',
      });
    const { prepared, tenantName } = await this.deps.composer.prepare(context, body);
    if (hasLiquidSyntaxError(prepared)) {
      throw new DomainError('VALIDATION', 'La plantilla tiene errores', {
        reason: 'BLOCKING_ISSUES',
      });
    }

    const results: Array<{ email: string; ok: boolean; error?: string }> = [];
    for (const email of input.emails) {
      const rendered = await this.deps.compiler.personalize(
        prepared,
        buildRecipientVariables({
          recipient: { ...SAMPLE_RECIPIENT, email },
          tenantName,
          links: PREVIEW_LINKS,
          now: this.deps.clock.now(),
        }),
      );
      const result = await gateway.provider.send({
        from: { name: sender.fromName, email: sender.fromEmail },
        to: email,
        replyTo: sender.replyTo,
        subject: `[Prueba] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
        messageId: `<test-${crypto.randomUUID()}@${senderDomain(sender.fromEmail)}>`,
        headers: { 'X-MCSN-Test': 'true' },
        idempotencyKey: crypto.randomUUID(),
      });
      results.push(result.ok ? { email, ok: true } : { email, ok: false, error: result.message });
    }
    await this.deps.audit.record(context, {
      action: 'campaign.test_sent',
      entityType: 'campaign',
      entityId: campaign.id,
      metadata: {
        recipients: input.emails.length,
        failed: results.filter((item) => !item.ok).length,
      },
    });
    return results;
  }

  async schedule(
    context: TenantContext,
    input: {
      campaignId: string;
      expectedVersion: number;
      scheduledAt: Date | null;
      confirmRecipients: number | null;
    },
  ) {
    assertCan(context, 'campaign:send');
    const campaign = await this.get(context, input.campaignId);
    if (campaign.status !== 'DRAFT')
      throw new DomainError('INVALID_STATE', 'La campaña ya se programó');
    if (campaign.version !== input.expectedVersion) {
      throw new DomainError('CONFLICT', 'La campaña cambió', { reason: 'STALE_VERSION' });
    }
    return this.freezeAndSchedule(context, campaign, {
      from: 'DRAFT',
      scheduledAt: input.scheduledAt,
      confirmRecipients: input.confirmRecipients,
      auditAction: 'campaign.scheduled',
    });
  }

  /**
   * Programa ya una campaña creada por una automatización sin aprobación. La confirmación del
   * número de destinatarios la sustituye la configuración de la automatización (hecha por una
   * persona con permiso de envío); por eso solo la puede usar el sistema.
   */
  async scheduleAutomated(context: TenantContext, campaignId: string) {
    if (context.actor.type !== 'system') {
      throw new DomainError('FORBIDDEN', 'Solo las automatizaciones programan sin confirmación');
    }
    const campaign = await this.get(context, campaignId);
    return this.freezeAndSchedule(context, campaign, {
      from: 'DRAFT',
      scheduledAt: null,
      confirmRecipients: 'skip',
      auditAction: 'campaign.scheduled',
    });
  }

  /** Deja la campaña a la espera de aprobación (no editable ni enviable hasta que se decida). */
  async submitForApproval(context: TenantContext, campaignId: string) {
    assertCan(context, 'campaign:write');
    await this.transitionOrFail(context, campaignId, ['DRAFT'], 'PENDING_APPROVAL', {
      bumpVersion: true,
    });
    await this.deps.audit.record(context, {
      action: 'campaign.approval_requested',
      entityType: 'campaign',
      entityId: campaignId,
    });
  }

  /**
   * Aprueba y programa para ya. `expectedTemplateVersion` es la versión de la plantilla que vio
   * quien aprueba: si alguien la editó después, la aprobación falla en lugar de enviar otra cosa.
   */
  async approve(
    context: TenantContext,
    campaignId: string,
    expected: { campaignVersion: number; templateVersion: number },
  ) {
    assertCan(context, 'campaign:send');
    const campaign = await this.get(context, campaignId);
    if (campaign.status !== 'PENDING_APPROVAL') {
      throw new DomainError('INVALID_STATE', 'La campaña no está pendiente de aprobación');
    }
    if (campaign.version !== expected.campaignVersion) {
      throw new DomainError('CONFLICT', 'La campaña cambió', { reason: 'STALE_VERSION' });
    }
    return this.freezeAndSchedule(context, campaign, {
      from: 'PENDING_APPROVAL',
      scheduledAt: null,
      confirmRecipients: 'skip',
      expectedTemplateVersion: expected.templateVersion,
      auditAction: 'campaign.approved',
    });
  }

  /** Aprobación caducada sin enviar: solo cancela si sigue pendiente (nunca una ya programada). */
  async expirePendingApproval(context: TenantContext, campaignId: string) {
    if (context.actor.type !== 'system') {
      throw new DomainError('FORBIDDEN', 'Solo el sistema caduca aprobaciones');
    }
    await this.transitionOrFail(context, campaignId, ['PENDING_APPROVAL'], 'CANCELLED', {
      finishedAt: this.deps.clock.now(),
    });
    await this.deps.audit.record(context, {
      action: 'campaign.approval_expired',
      entityType: 'campaign',
      entityId: campaignId,
    });
  }

  /** Rechazo: la campaña vuelve a borrador para editarla o descartarla. */
  async returnToDraft(context: TenantContext, campaignId: string) {
    assertCan(context, 'campaign:send');
    await this.transitionOrFail(context, campaignId, ['PENDING_APPROVAL'], 'DRAFT', {
      bumpVersion: true,
    });
    await this.deps.audit.record(context, {
      action: 'campaign.approval_rejected',
      entityType: 'campaign',
      entityId: campaignId,
    });
  }

  private async freezeAndSchedule(
    context: TenantContext,
    campaign: CampaignRecord,
    options: {
      from: 'DRAFT' | 'PENDING_APPROVAL';
      scheduledAt: Date | null;
      confirmRecipients: number | null | 'skip';
      expectedTemplateVersion?: number;
      auditAction: string;
    },
  ) {
    const now = this.deps.clock.now();
    const scheduledAt = options.scheduledAt ?? now;
    if (scheduledAt.getTime() < now.getTime() - 60_000) {
      throw new DomainError('VALIDATION', 'La fecha ya pasó', { reason: 'SCHEDULE_IN_PAST' });
    }
    const { issues, recipients } = await this.runChecks(context, campaign);
    if (hasBlockingIssues(issues)) {
      throw new DomainError('VALIDATION', 'Hay errores que impiden el envío', {
        reason: 'BLOCKING_ISSUES',
      });
    }
    if (
      options.confirmRecipients !== 'skip' &&
      recipients >= SEND_CONFIRMATION_THRESHOLD &&
      options.confirmRecipients !== recipients
    ) {
      throw new DomainError('VALIDATION', 'Confirma el número de destinatarios', {
        reason: 'CONFIRMATION_REQUIRED',
        recipients,
      });
    }
    const template = campaign.templateId
      ? await this.deps.templates.findById(context, campaign.templateId)
      : null;
    if (!template)
      throw new DomainError('VALIDATION', 'Plantilla inexistente', { reason: 'TEMPLATE_MISSING' });
    if (
      options.expectedTemplateVersion !== undefined &&
      template.currentVersion !== options.expectedTemplateVersion
    ) {
      throw new DomainError('CONFLICT', 'La plantilla cambió', { reason: 'TEMPLATE_CHANGED' });
    }

    const scheduled = await this.deps.campaigns.transition(
      context,
      campaign.id,
      [options.from],
      'SCHEDULED',
      {
        scheduledAt,
        body: template.body,
        templateVersion: template.currentVersion,
        error: null,
        bumpVersion: true,
      },
    );
    if (!scheduled)
      throw new DomainError('CONFLICT', 'La campaña cambió', { reason: 'STALE_VERSION' });
    await this.deps.queue.enqueueDispatch(
      context,
      campaign.id,
      campaign.version + 1,
      Math.max(0, scheduledAt.getTime() - now.getTime()),
    );
    await this.deps.audit.record(context, {
      action: options.auditAction,
      entityType: 'campaign',
      entityId: campaign.id,
      metadata: {
        scheduledAt: scheduledAt.toISOString(),
        recipients,
        templateVersion: template.currentVersion,
      },
    });
    return { recipients, scheduledAt };
  }

  /** Vuelve a borrador una campaña programada (el job pendiente queda invalidado por la versión). */
  async unschedule(context: TenantContext, campaignId: string) {
    assertCan(context, 'campaign:send');
    await this.transitionOrFail(context, campaignId, ['SCHEDULED'], 'DRAFT', {
      scheduledAt: null,
      bumpVersion: true,
    });
    await this.deps.audit.record(context, {
      action: 'campaign.unscheduled',
      entityType: 'campaign',
      entityId: campaignId,
    });
  }

  async pause(context: TenantContext, campaignId: string) {
    assertCan(context, 'campaign:send');
    await this.transitionOrFail(context, campaignId, ['DISPATCHING', 'SENDING'], 'PAUSED', {});
    await this.deps.audit.record(context, {
      action: 'campaign.paused',
      entityType: 'campaign',
      entityId: campaignId,
    });
  }

  async resume(context: TenantContext, campaignId: string) {
    assertCan(context, 'campaign:send');
    const campaign = await this.get(context, campaignId);
    if (campaign.status !== 'PAUSED')
      throw new DomainError('INVALID_STATE', 'La campaña no está en pausa');
    const sender = campaign.senderIdentityId
      ? await this.deps.senders.findById(context, campaign.senderIdentityId)
      : null;
    const provider = sender
      ? await this.deps.providers.findById(context, sender.providerConfigId)
      : null;
    if (provider?.status !== 'ACTIVE') {
      throw new DomainError('INVALID_STATE', 'El proveedor no está operativo', {
        reason: 'PROVIDER_ERROR',
      });
    }
    const target = campaign.dispatchedAt ? 'SENDING' : 'DISPATCHING';
    await this.transitionOrFail(context, campaignId, ['PAUSED'], target, { error: null });
    if (target === 'DISPATCHING') {
      await this.deps.queue.enqueueDispatch(context, campaignId, campaign.version, 0);
    }
    let cursor: string | null = null;
    for (;;) {
      const ids = await this.deps.deliveries.queuedIds(context, campaignId, cursor, RESUME_BATCH);
      if (ids.length === 0) break;
      await this.deps.queue.enqueueSends(context, ids);
      cursor = ids[ids.length - 1] ?? null;
    }
    await this.deps.audit.record(context, {
      action: 'campaign.resumed',
      entityType: 'campaign',
      entityId: campaignId,
    });
  }

  async cancel(context: TenantContext, campaignId: string) {
    assertCan(context, 'campaign:send');
    await this.transitionOrFail(
      context,
      campaignId,
      ['PENDING_APPROVAL', 'SCHEDULED', 'DISPATCHING', 'SENDING', 'PAUSED'],
      'CANCELLED',
      { finishedAt: this.deps.clock.now() },
    );
    const cancelled = await this.deps.deliveries.cancelQueued(context, campaignId);
    await this.deps.audit.record(context, {
      action: 'campaign.cancelled',
      entityType: 'campaign',
      entityId: campaignId,
      metadata: { cancelledDeliveries: cancelled },
    });
  }

  async report(context: TenantContext, campaignId: string) {
    const campaign = await this.get(context, campaignId);
    const [stats, links] = await Promise.all([
      this.deps.deliveries.stats(context, campaignId),
      this.deps.deliveries.linkStats(context, campaignId),
    ]);
    return { campaign, stats, links };
  }

  /** Actividad diaria de envío (enviados, aperturas y clics) de los últimos `days` días. */
  activity(context: TenantContext, days: number) {
    assertCan(context, 'campaign:read');
    const since = new Date(this.deps.clock.now().getTime() - days * 24 * 60 * 60 * 1000);
    return this.deps.deliveries.dailyActivity(context, since);
  }

  async deliveries(
    context: TenantContext,
    campaignId: string,
    query: {
      status?: DeliveryStatus | undefined;
      search?: string | undefined;
      page: number;
      pageSize: number;
    },
  ) {
    await this.get(context, campaignId);
    return this.deps.deliveries.page(context, campaignId, query);
  }

  private async transitionOrFail(
    context: TenantContext,
    campaignId: string,
    from: Parameters<CampaignRepository['transition']>[2],
    to: Parameters<CampaignRepository['transition']>[3],
    patch: Parameters<CampaignRepository['transition']>[4],
  ) {
    await this.get(context, campaignId);
    if (!(await this.deps.campaigns.transition(context, campaignId, from, to, patch))) {
      throw new DomainError('INVALID_STATE', 'La operación no es posible en el estado actual');
    }
  }

  private async bodyFor(
    context: TenantContext,
    campaign: CampaignRecord,
  ): Promise<TemplateBody | null> {
    if (campaign.body) return campaign.body;
    if (!campaign.templateId) return null;
    return (await this.deps.templates.findById(context, campaign.templateId))?.body ?? null;
  }

  private async runChecks(context: TenantContext, campaign: CampaignRecord) {
    const issues: CampaignIssue[] = [];
    const body = await this.bodyFor(context, campaign);
    if (!body) {
      issues.push({ code: 'TEMPLATE_MISSING', severity: 'error' });
    } else {
      const { prepared } = await this.deps.composer.prepare(context, body);
      issues.push(...prepared.issues);
    }
    const sender = campaign.senderIdentityId
      ? await this.deps.senders.findById(context, campaign.senderIdentityId)
      : null;
    if (!sender) {
      issues.push({ code: 'SENDER_MISSING', severity: 'error' });
    } else {
      if (!isDnsHealthy(sender.dnsCheck)) {
        issues.push({
          code: 'SENDER_DNS',
          severity: 'warning',
          detail: senderDomain(sender.fromEmail),
        });
      }
      const provider = await this.deps.providers.findById(context, sender.providerConfigId);
      if (provider?.status !== 'ACTIVE') {
        issues.push({ code: 'PROVIDER_ERROR', severity: 'error', detail: provider?.name ?? '' });
      }
    }
    const recipients = await this.deps.audience.count(context, campaign.audience, campaign.topicId);
    if (recipients === 0) issues.push({ code: 'NO_RECIPIENTS', severity: 'error' });
    issues.sort((a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'));
    return { issues, recipients };
  }

  private async assertReferences(context: TenantContext, input: UpdateCampaignInput) {
    if (!(await this.deps.templates.findById(context, input.templateId))) {
      throw new DomainError('VALIDATION', 'Plantilla inválida', { field: 'templateId' });
    }
    if (
      input.senderIdentityId &&
      !(await this.deps.senders.findById(context, input.senderIdentityId))
    ) {
      throw new DomainError('VALIDATION', 'Remitente inválido', { field: 'senderIdentityId' });
    }
    if (input.topicId && (await this.deps.topics.countExisting(context, [input.topicId])) !== 1) {
      throw new DomainError('VALIDATION', 'Tema inválido', { field: 'topicId' });
    }
    const listIds = [...new Set([...input.audience.listIds, ...input.audience.excludeListIds])];
    if ((await this.deps.lists.countExisting(context, listIds)) !== listIds.length) {
      throw new DomainError('VALIDATION', 'Lista inválida', { field: 'audience' });
    }
    for (const segmentId of input.audience.segmentIds) {
      if (!(await this.deps.segments.findById(context, segmentId))) {
        throw new DomainError('VALIDATION', 'Segmento inválido', { field: 'audience' });
      }
    }
  }
}
