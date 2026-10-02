/**
 * Despacho y envío de campañas (worker).
 *
 * Despacho: SCHEDULED → DISPATCHING, compila el correo una sola vez (con el píxel y los enlaces de
 * seguimiento sustituidos por variables), recorre la audiencia por cursor en lotes, crea las
 * entregas (únicas por campaña y contacto) y encola su envío. Es reanudable: tras una caída o una
 * pausa continúa desde el último cursor sin duplicar entregas.
 *
 * Envío: toma la entrega con una transición atómica QUEUED → SENDING, respeta los límites del
 * proveedor y de la campaña, personaliza y entrega. Errores:
 * - autenticación/configuración: el proveedor pasa a ERROR y la campaña se pausa (circuit breaker);
 * - transitorios: vuelve a la cola con backoff; en el último intento queda FAILED;
 * - rechazos definitivos: FAILED (y supresión si la dirección no existe).
 */
import type { Clock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { senderDomain } from '@/core/providers/provider-config';
import type {
  EmailProviderGateway,
  ProviderConfigRepository,
  SenderRepository,
} from '@/core/providers/ports';
import { hasLiquidSyntaxError, type EmailComposer } from '@/core/templates/email-composer';
import type { EmailCompiler } from '@/core/templates/ports';
import { hasBlockingIssues } from '@/core/templates/template-issues';
import { buildRecipientVariables } from '@/core/templates/template-variables';
import type { BrandingRepository } from '@/core/tenants/branding';
import { variantFor } from '../campaign';
import { STALE_SENDING_MS } from '../delivery';
import type {
  AudienceResolver,
  CampaignQueue,
  CampaignRepository,
  CompiledCampaign,
  DeliveryRepository,
  EmailInstrumenter,
  RecipientPreferencesRepository,
  SendLimit,
  SendThrottle,
  TrackingLinks,
} from '../ports';

export const DISPATCH_BATCH_SIZE = 1000;

export interface DispatchDeps {
  campaigns: CampaignRepository;
  deliveries: DeliveryRepository;
  audience: AudienceResolver;
  queue: CampaignQueue;
  senders: SenderRepository;
  composer: EmailComposer;
  instrumenter: EmailInstrumenter;
  clock: Clock;
}

export class DispatchCampaignUseCase {
  constructor(private readonly deps: DispatchDeps) {}

  async execute(context: TenantContext, campaignId: string, version: number): Promise<void> {
    const campaign = await this.deps.campaigns.findById(context, campaignId);
    if (!campaign || campaign.version !== version) return; // job obsoleto (reprogramada o editada)
    if (campaign.status === 'SCHEDULED') {
      const started = await this.deps.campaigns.transition(
        context,
        campaignId,
        ['SCHEDULED'],
        'DISPATCHING',
        {
          startedAt: this.deps.clock.now(),
        },
      );
      if (!started) return;
    } else if (campaign.status !== 'DISPATCHING') {
      return; // pausada, cancelada o ya despachada
    }

    const sender = campaign.senderIdentityId
      ? await this.deps.senders.findById(context, campaign.senderIdentityId)
      : null;
    if (!sender || !campaign.body) {
      await this.fail(context, campaignId, 'SENDER_OR_CONTENT_MISSING');
      return;
    }

    if (!(await this.deps.campaigns.findCompiled(context, campaignId))) {
      const { prepared } = await this.deps.composer.prepare(context, campaign.body);
      if (hasLiquidSyntaxError(prepared) || hasBlockingIssues(prepared.issues)) {
        await this.fail(context, campaignId, 'BLOCKING_ISSUES');
        return;
      }
      const { html, links } = this.deps.instrumenter.instrument(prepared.html, {
        trackOpens: campaign.trackOpens,
        trackClicks: campaign.trackClicks,
      });
      await this.deps.campaigns.saveCompiled(
        context,
        campaignId,
        { subject: prepared.subject, subjectB: campaign.subjectB, html, text: prepared.text },
        links,
      );
    }

    let cursor = campaign.dispatchCursor;
    for (;;) {
      const recipients = await this.deps.audience.page(
        context,
        campaign.audience,
        campaign.topicId,
        cursor,
        DISPATCH_BATCH_SIZE,
      );
      if (recipients.length === 0) break;
      await this.deps.deliveries.createBatch(
        context,
        campaignId,
        sender.providerConfigId,
        recipients.map((recipient) => ({
          contactId: recipient.contactId,
          email: recipient.email,
          variant: campaign.subjectB ? variantFor(recipient.contactId) : null,
        })),
      );
      const ids = await this.deps.deliveries.queuedIdsForContacts(
        context,
        campaignId,
        recipients.map((recipient) => recipient.contactId),
      );
      await this.deps.queue.enqueueSends(context, ids);
      cursor = recipients[recipients.length - 1]?.contactId ?? cursor;
      if (cursor) await this.deps.campaigns.setDispatchCursor(context, campaignId, cursor);

      const current = await this.deps.campaigns.findById(context, campaignId);
      if (current?.status !== 'DISPATCHING') return; // pausada o cancelada durante el despacho
    }

    const total = await this.deps.deliveries.count(context, campaignId);
    const now = this.deps.clock.now();
    await this.deps.campaigns.transition(context, campaignId, ['DISPATCHING'], 'SENDING', {
      dispatchedAt: now,
      recipientCount: total,
    });
    if ((await this.deps.deliveries.countActive(context, campaignId)) === 0) {
      await this.deps.campaigns.transition(context, campaignId, ['SENDING'], 'SENT', {
        finishedAt: now,
      });
    }
  }

  private async fail(context: TenantContext, campaignId: string, error: string) {
    await this.deps.campaigns.transition(context, campaignId, ['DISPATCHING'], 'FAILED', {
      error,
      finishedAt: this.deps.clock.now(),
    });
  }
}

export interface SendDeps {
  campaigns: CampaignRepository;
  deliveries: DeliveryRepository;
  senders: SenderRepository;
  providers: ProviderConfigRepository;
  gateway: EmailProviderGateway;
  throttle: SendThrottle;
  links: TrackingLinks;
  compiler: EmailCompiler;
  branding: BrandingRepository;
  preferences: RecipientPreferencesRepository;
  clock: Clock;
}

export type SendOutcome = { type: 'done' } | { type: 'delay'; delayMs: number };

/** Error transitorio: el job se reintenta con backoff exponencial. */
export class TransientSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientSendError';
  }
}

const COMPILED_CACHE_LIMIT = 50;

export class SendDeliveryUseCase {
  /** El contenido compilado es inmutable una vez despachada la campaña: se cachea por proceso. */
  private readonly compiledCache = new Map<
    string,
    { compiled: CompiledCampaign; tenantName: string }
  >();

  constructor(private readonly deps: SendDeps) {}

  async execute(
    context: TenantContext,
    deliveryId: string,
    options: { finalAttempt: boolean },
  ): Promise<SendOutcome> {
    const campaignRef = await this.deliveryCampaign(context, deliveryId);
    if (!campaignRef) return { type: 'done' };
    const { campaign, delivery } = campaignRef;

    if (campaign.status === 'CANCELLED') {
      await this.deps.deliveries.markFinal(context, deliveryId, 'CANCELLED', null);
      return { type: 'done' };
    }
    if (campaign.status !== 'SENDING' && campaign.status !== 'DISPATCHING') {
      return { type: 'done' }; // en pausa: la entrega sigue en cola y se reencola al reanudar
    }
    if (!delivery.eligible) {
      await this.deps.deliveries.markFinal(context, deliveryId, 'SUPPRESSED', null);
      return { type: 'done' };
    }

    const gateway = await this.deps.gateway.forProvider(context, delivery.providerConfigId);
    if (!gateway) {
      await this.deps.deliveries.markFinal(context, deliveryId, 'FAILED', 'PROVIDER_MISSING');
      return { type: 'done' };
    }
    if (gateway.status !== 'ACTIVE') {
      await this.pauseForProvider(context, campaign.id, 'PROVIDER_ERROR');
      return { type: 'done' };
    }

    const limits: SendLimit[] = [
      { mode: 'rate', points: gateway.rateLimitPerSecond, durationSeconds: 1 },
    ];
    if (gateway.maxPerDay) {
      limits.push({ mode: 'quota', points: gateway.maxPerDay, durationSeconds: 86_400 });
    }
    const providerSlot = await this.deps.throttle.acquire(
      `provider:${delivery.providerConfigId}`,
      limits,
    );
    if (!providerSlot.ok) return { type: 'delay', delayMs: providerSlot.retryAfterMs };
    if (campaign.throttlePerHour) {
      const campaignSlot = await this.deps.throttle.acquire(`campaign:${campaign.id}`, [
        { mode: 'quota', points: campaign.throttlePerHour, durationSeconds: 3600 },
      ]);
      if (!campaignSlot.ok) return { type: 'delay', delayMs: campaignSlot.retryAfterMs };
    }

    const now = this.deps.clock.now();
    if (!(await this.deps.deliveries.claim(context, deliveryId, now))) return { type: 'done' };

    const sender = campaign.senderIdentityId
      ? await this.deps.senders.findById(context, campaign.senderIdentityId)
      : null;
    const content = await this.compiled(context, campaign.id);
    if (!sender || !content) {
      await this.deps.deliveries.markFinal(context, deliveryId, 'FAILED', 'CONTENT_MISSING');
      return { type: 'done' };
    }

    const unsubscribeUrl = this.deps.links.unsubscribeUrl(context.tenantId, deliveryId);
    const linkIds = await this.linkIds(context, campaign.id);
    const variables = {
      ...buildRecipientVariables({
        recipient: delivery.recipient,
        tenantName: content.tenantName,
        links: {
          unsubscribeUrl: `${unsubscribeUrl}?intent=unsubscribe`,
          preferencesUrl: this.deps.links.preferencesUrl(context.tenantId, deliveryId),
        },
        now,
      }),
      tracking: {
        open_url: this.deps.links.openUrl(context.tenantId, deliveryId),
        links: Object.fromEntries(
          linkIds.map(({ key, id }) => [
            key,
            this.deps.links.clickUrl(context.tenantId, deliveryId, id),
          ]),
        ),
      },
    };
    const subject =
      delivery.variant === 'B' && content.compiled.subjectB
        ? content.compiled.subjectB
        : content.compiled.subject;
    const rendered = await this.deps.compiler.personalize(
      { subject, html: content.compiled.html, text: content.compiled.text, issues: [] },
      variables,
    );

    const result = await gateway.provider.send({
      from: { name: sender.fromName, email: sender.fromEmail },
      to: delivery.email,
      replyTo: sender.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      messageId: `<${deliveryId}@${senderDomain(sender.fromEmail)}>`,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-MCSN-Delivery': deliveryId,
      },
      idempotencyKey: deliveryId,
    });

    if (result.ok) {
      const sentAt = this.deps.clock.now();
      await this.deps.deliveries.markSent(context, deliveryId, result.providerMessageId, sentAt);
      await this.deps.deliveries.addEvent(context, {
        deliveryId,
        campaignId: campaign.id,
        type: 'SENT',
        source: 'system',
        occurredAt: sentAt,
      });
      return { type: 'done' };
    }

    switch (result.code) {
      case 'AUTH':
      case 'CONFIG':
        await this.deps.deliveries.release(context, deliveryId, result.message);
        await this.deps.providers.setStatus(
          context,
          delivery.providerConfigId,
          'ERROR',
          result.message.slice(0, 500),
          null,
        );
        await this.pauseForProvider(context, campaign.id, 'PROVIDER_ERROR');
        return { type: 'done' };
      case 'RATE_LIMITED':
        await this.deps.deliveries.release(context, deliveryId, result.message);
        return { type: 'delay', delayMs: result.retryAfterMs ?? 5000 };
      case 'TRANSIENT':
        if (options.finalAttempt) {
          await this.deps.deliveries.markFinal(context, deliveryId, 'FAILED', result.message);
          await this.failedEvent(context, deliveryId, campaign.id, result.message);
          return { type: 'done' };
        }
        await this.deps.deliveries.release(context, deliveryId, result.message);
        throw new TransientSendError(result.message);
      case 'REJECTED':
      case 'INVALID_RECIPIENT':
        await this.deps.deliveries.markFinal(context, deliveryId, 'FAILED', result.message);
        await this.failedEvent(context, deliveryId, campaign.id, result.message);
        if (result.code === 'INVALID_RECIPIENT') {
          await this.deps.preferences.suppress(
            context,
            { id: delivery.contactId, email: delivery.email },
            'INVALID',
            'provider',
          );
        }
        return { type: 'done' };
    }
  }

  private async deliveryCampaign(context: TenantContext, deliveryId: string) {
    const tracking = await this.deps.deliveries.findForTracking(context, deliveryId);
    if (!tracking) return null;
    const campaign = await this.deps.campaigns.findById(context, tracking.campaignId);
    if (!campaign) return null;
    const delivery = await this.deps.deliveries.findForSend(context, deliveryId, campaign.topicId);
    if (delivery?.status !== 'QUEUED') return null;
    return { campaign, delivery };
  }

  private async compiled(context: TenantContext, campaignId: string) {
    const cached = this.compiledCache.get(campaignId);
    if (cached) return cached;
    const [compiled, profile] = await Promise.all([
      this.deps.campaigns.findCompiled(context, campaignId),
      this.deps.branding.getEmailProfile(context),
    ]);
    if (!compiled) return null;
    const entry = { compiled, tenantName: profile.name };
    if (this.compiledCache.size >= COMPILED_CACHE_LIMIT) {
      const oldest = this.compiledCache.keys().next().value;
      if (oldest !== undefined) this.compiledCache.delete(oldest);
    }
    this.compiledCache.set(campaignId, entry);
    return entry;
  }

  /** Correspondencia entre las variables `tracking.links.lN` del HTML y los ids de enlace. */
  private readonly linkCache = new Map<string, Array<{ key: string; id: string }>>();

  private async linkIds(context: TenantContext, campaignId: string) {
    const cached = this.linkCache.get(campaignId);
    if (cached) return cached;
    const links = await this.deps.campaigns.findLinks(context, campaignId);
    const resolved = links.map((link) => ({ key: `l${link.position}`, id: link.id }));
    if (this.linkCache.size >= COMPILED_CACHE_LIMIT) this.linkCache.clear();
    this.linkCache.set(campaignId, resolved);
    return resolved;
  }

  private async pauseForProvider(context: TenantContext, campaignId: string, error: string) {
    await this.deps.campaigns.transition(
      context,
      campaignId,
      ['DISPATCHING', 'SENDING'],
      'PAUSED',
      { error },
    );
  }

  private async failedEvent(
    context: TenantContext,
    deliveryId: string,
    campaignId: string,
    message: string,
  ) {
    await this.deps.deliveries.addEvent(context, {
      deliveryId,
      campaignId,
      type: 'FAILED',
      source: 'provider',
      metadata: { message: message.slice(0, 300) },
      occurredAt: this.deps.clock.now(),
    });
  }
}

export interface MaintenanceDeps {
  campaigns: CampaignRepository;
  deliveries: DeliveryRepository;
  queue: CampaignQueue;
  clock: Clock;
}

/** Tareas periódicas del worker que hacen el envío robusto ante caídas. */
export class CampaignMaintenanceUseCase {
  constructor(private readonly deps: MaintenanceDeps) {}

  /** Red de seguridad: encola el despacho de campañas programadas ya vencidas (job idempotente). */
  async enqueueDue(): Promise<number> {
    const due = await this.deps.campaigns.findDue(this.deps.clock.now());
    for (const campaign of due) {
      await this.deps.queue.enqueueDispatch(
        this.context(campaign),
        campaign.id,
        campaign.version,
        0,
      );
    }
    return due.length;
  }

  /** Cierra las campañas sin entregas pendientes. */
  async completeFinished(): Promise<number> {
    let completed = 0;
    for (const campaign of await this.deps.campaigns.findSending()) {
      const context = this.context(campaign);
      if ((await this.deps.deliveries.countActive(context, campaign.id)) > 0) continue;
      if (
        await this.deps.campaigns.transition(context, campaign.id, ['SENDING'], 'SENT', {
          finishedAt: this.deps.clock.now(),
        })
      ) {
        completed += 1;
      }
    }
    return completed;
  }

  /** Devuelve a la cola las entregas que quedaron en vuelo por una caída del worker. */
  async recoverStale(): Promise<number> {
    const before = new Date(this.deps.clock.now().getTime() - STALE_SENDING_MS);
    const stale = await this.deps.deliveries.findStale(before);
    for (const delivery of stale) {
      const context = this.context(delivery);
      await this.deps.deliveries.release(context, delivery.id, 'RECOVERED_AFTER_CRASH');
      await this.deps.queue.enqueueSends(context, [delivery.id]);
    }
    return stale.length;
  }

  private context(ref: { tenantId: string; tenantSlug: string }): TenantContext {
    return {
      tenantId: ref.tenantId,
      tenantSlug: ref.tenantSlug,
      actor: { type: 'system', reason: 'campaign-maintenance' },
    };
  }
}
