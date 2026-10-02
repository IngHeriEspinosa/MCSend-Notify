/**
 * Seguimiento de destinatarios (rutas públicas `/trk/*` con token firmado):
 * aperturas, clics, descargas, baja con un clic (RFC 8058) y centro de preferencias.
 *
 * El token ya viene verificado por la capa de presentación; aquí se trabaja con un contexto de
 * sistema acotado a su tenant. Los escáneres de enlaces y las aperturas automáticas se registran
 * marcados y no cuentan como interacción humana.
 */
import { z } from 'zod';
import type { Clock } from '@/core/shared/ports';
import { systemContext, type TenantContext } from '@/core/shared/tenant-context';
import type { BrandingRepository } from '@/core/tenants/branding';
import { isLinkScanner, isMachineOpen, maskEmail } from '../delivery';
import type {
  CampaignRepository,
  DeliveryRepository,
  RecipientPreferencesRepository,
  TrackingLinks,
} from '../ports';

export interface TrackingDeps {
  campaigns: CampaignRepository;
  deliveries: DeliveryRepository;
  preferences: RecipientPreferencesRepository;
  links: TrackingLinks;
  branding: BrandingRepository;
  clock: Clock;
}

export interface TrackingMeta {
  userAgent?: string | undefined;
  ipHash?: string | undefined;
  method?: string | undefined;
}

export const updatePreferencesSchema = z.object({
  unsubscribeAll: z.boolean(),
  topics: z.record(z.uuid(), z.boolean()),
});

function trackingContext(tenantId: string): TenantContext {
  return systemContext(tenantId, '', 'tracking');
}

export class TrackingUseCase {
  constructor(private readonly deps: TrackingDeps) {}

  async open(tenantId: string, deliveryId: string, meta: TrackingMeta): Promise<void> {
    const context = trackingContext(tenantId);
    const delivery = await this.deps.deliveries.findForTracking(context, deliveryId);
    if (!delivery) return;
    const machine = isMachineOpen(meta.userAgent);
    const now = this.deps.clock.now();
    await this.deps.deliveries.recordOpen(context, deliveryId, now, machine);
    await this.deps.deliveries.addEvent(context, {
      deliveryId,
      campaignId: delivery.campaignId,
      type: 'OPENED',
      source: 'tracking',
      ipHash: meta.ipHash,
      userAgent: meta.userAgent?.slice(0, 300),
      isBot: machine,
      occurredAt: now,
    });
  }

  /** Registra el clic y devuelve la URL de destino guardada (nunca una URL del token). */
  async click(
    tenantId: string,
    deliveryId: string,
    linkId: string,
    meta: TrackingMeta,
  ): Promise<string | null> {
    const context = trackingContext(tenantId);
    const delivery = await this.deps.deliveries.findForTracking(context, deliveryId);
    if (!delivery) return null;
    const link = await this.deps.campaigns.findLink(context, delivery.campaignId, linkId);
    if (!link) return null;

    const bot = isLinkScanner(meta.userAgent, meta.method ?? 'GET');
    const now = this.deps.clock.now();
    if (!bot) {
      await this.deps.deliveries.recordClick(context, deliveryId, now);
      // Un clic implica una apertura aunque el cliente bloquee las imágenes.
      if (!delivery.firstOpenedAt)
        await this.deps.deliveries.recordOpen(context, deliveryId, now, false);
    }
    const event = {
      deliveryId,
      campaignId: delivery.campaignId,
      source: 'tracking' as const,
      linkId: link.id,
      ipHash: meta.ipHash,
      userAgent: meta.userAgent?.slice(0, 300),
      isBot: bot,
      occurredAt: now,
    };
    await this.deps.deliveries.addEvent(context, { ...event, type: 'CLICKED' });
    if (this.deps.links.isDocumentDownload(link.url)) {
      await this.deps.deliveries.addEvent(context, { ...event, type: 'DOWNLOADED' });
    }
    return link.url;
  }

  /**
   * Baja con un clic (cabecera List-Unsubscribe-Post): si la campaña tiene tema, da de baja de
   * ese tema; si no, de todas las comunicaciones del tenant.
   */
  async unsubscribe(tenantId: string, deliveryId: string, meta: TrackingMeta): Promise<boolean> {
    const context = trackingContext(tenantId);
    const delivery = await this.deps.deliveries.findForTracking(context, deliveryId);
    if (!delivery) return false;
    const campaign = await this.deps.campaigns.findById(context, delivery.campaignId);
    if (campaign?.topicId) {
      await this.deps.preferences.setTopic(context, delivery.contactId, campaign.topicId, false);
    } else {
      await this.deps.preferences.suppress(
        context,
        { id: delivery.contactId, email: delivery.email },
        'UNSUBSCRIBE',
        'unsubscribe',
      );
    }
    await this.recordUnsubscribe(
      context,
      delivery,
      { scope: campaign?.topicId ? 'topic' : 'all' },
      meta,
    );
    return true;
  }

  async preferences(tenantId: string, deliveryId: string) {
    const context = trackingContext(tenantId);
    const delivery = await this.deps.deliveries.findForTracking(context, deliveryId);
    if (!delivery) return null;
    const [campaign, recipient, profile] = await Promise.all([
      this.deps.campaigns.findById(context, delivery.campaignId),
      this.deps.preferences.load(context, delivery.contactId),
      this.deps.branding.getEmailProfile(context),
    ]);
    if (!recipient) return null;
    return {
      tenantName: profile.name,
      locale: campaign?.body?.locale ?? (profile.defaultLocale === 'en' ? 'en' : 'es'),
      email: maskEmail(recipient.email),
      unsubscribedAll: recipient.status === 'UNSUBSCRIBED',
      campaignTopicId: campaign?.topicId ?? null,
      topics: recipient.topics,
    };
  }

  async updatePreferences(
    tenantId: string,
    deliveryId: string,
    input: z.infer<typeof updatePreferencesSchema>,
  ): Promise<boolean> {
    const context = trackingContext(tenantId);
    const delivery = await this.deps.deliveries.findForTracking(context, deliveryId);
    if (!delivery) return false;
    if (input.unsubscribeAll) {
      await this.deps.preferences.suppress(
        context,
        { id: delivery.contactId, email: delivery.email },
        'UNSUBSCRIBE',
        'preferences',
      );
      await this.recordUnsubscribe(context, delivery, { scope: 'all' }, {});
      return true;
    }
    const recipient = await this.deps.preferences.load(context, delivery.contactId);
    if (!recipient) return false;
    const known = new Set(recipient.topics.map((topic) => topic.id));
    let optedOut = false;
    for (const [topicId, subscribed] of Object.entries(input.topics)) {
      if (!known.has(topicId)) continue;
      await this.deps.preferences.setTopic(context, delivery.contactId, topicId, subscribed);
      optedOut ||= !subscribed;
    }
    if (optedOut) await this.recordUnsubscribe(context, delivery, { scope: 'topics' }, {});
    return true;
  }

  private async recordUnsubscribe(
    context: TenantContext,
    delivery: { id: string; campaignId: string },
    metadata: Record<string, unknown>,
    meta: TrackingMeta,
  ) {
    const now = this.deps.clock.now();
    await this.deps.deliveries.recordUnsubscribe(context, delivery.id, now);
    await this.deps.deliveries.addEvent(context, {
      deliveryId: delivery.id,
      campaignId: delivery.campaignId,
      type: 'UNSUBSCRIBED',
      source: 'tracking',
      ipHash: meta.ipHash,
      userAgent: meta.userAgent?.slice(0, 300),
      metadata,
      occurredAt: now,
    });
  }
}
