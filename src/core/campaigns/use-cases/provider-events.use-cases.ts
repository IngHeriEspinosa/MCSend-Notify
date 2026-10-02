/**
 * Eventos de los proveedores (webhooks de Resend y de Amazon SES vía SNS):
 * 1. Ingesta (route handler): verifica la firma, normaliza, guarda deduplicando por id de evento
 *    y encola. Responde rápido para que el proveedor no reintente.
 * 2. Aplicación (worker): transición monótona de la entrega y supresión automática en rebotes
 *    permanentes y quejas (protege la reputación del remitente).
 */
import { DomainError } from '@/core/shared/domain-error';
import type { Clock, SecretCipher } from '@/core/shared/ports';
import { systemContext, type TenantContext } from '@/core/shared/tenant-context';
import type { EmailProviderKind } from '@/core/providers/provider-config';
import type { ProviderConfigRepository } from '@/core/providers/ports';
import { providerCredentialsAad } from '@/core/providers/use-cases/providers.use-cases';
import type { DeliveryRepository, RecipientPreferencesRepository } from '../ports';

export const PROVIDER_EVENT_TYPES = [
  'DELIVERED',
  'HARD_BOUNCE',
  'SOFT_BOUNCE',
  'COMPLAINT',
] as const;
export type ProviderEventType = (typeof PROVIDER_EVENT_TYPES)[number];

export interface NormalizedProviderEvent {
  providerEventId: string;
  type: ProviderEventType;
  providerMessageId: string;
  occurredAt: Date;
  detail?: string | undefined;
}

export interface WebhookRequest {
  headers: Record<string, string>;
  body: string;
}

export type ParsedWebhook =
  | { kind: 'events'; events: NormalizedProviderEvent[] }
  | { kind: 'subscription'; confirmUrl: string };

/** Verifica la firma y normaliza el webhook. Lanza FORBIDDEN si la firma no es válida. */
export interface ProviderWebhookParser {
  parse(
    kind: EmailProviderKind,
    credentials: unknown,
    request: WebhookRequest,
  ): Promise<ParsedWebhook>;
  confirmSubscription(confirmUrl: string): Promise<void>;
}

export interface StoredProviderEvent extends NormalizedProviderEvent {
  id: string;
  providerConfigId: string;
  processedAt: Date | null;
}

export interface InboundEventRepository {
  /** Devuelve el id o null si el evento ya existía (reintento del proveedor). */
  insert(
    context: TenantContext,
    providerConfigId: string,
    event: NormalizedProviderEvent,
  ): Promise<string | null>;
  findById(context: TenantContext, eventId: string): Promise<StoredProviderEvent | null>;
  markProcessed(context: TenantContext, eventId: string, at: Date): Promise<void>;
}

export interface ProviderEventQueue {
  enqueue(context: TenantContext, eventId: string): Promise<void>;
}

export class IngestProviderWebhookUseCase {
  constructor(
    private readonly deps: {
      providers: ProviderConfigRepository;
      cipher: SecretCipher;
      parser: ProviderWebhookParser;
      events: InboundEventRepository;
      queue: ProviderEventQueue;
    },
  ) {}

  async execute(endpointToken: string, request: WebhookRequest): Promise<{ accepted: number }> {
    const provider = await this.deps.providers.findByEndpointToken(endpointToken);
    if (
      !provider ||
      (provider.kind !== 'RESEND' && provider.kind !== 'SES') ||
      !provider.credentialsEnc
    ) {
      throw new DomainError('NOT_FOUND', 'Endpoint desconocido');
    }
    const credentials: unknown = JSON.parse(
      this.deps.cipher.decrypt(
        provider.credentialsEnc,
        providerCredentialsAad(provider.tenantId, provider.id),
      ),
    );
    const parsed = await this.deps.parser.parse(provider.kind, credentials, request);
    if (parsed.kind === 'subscription') {
      await this.deps.parser.confirmSubscription(parsed.confirmUrl);
      return { accepted: 0 };
    }
    const context = systemContext(provider.tenantId, '', 'provider-webhook');
    let accepted = 0;
    for (const event of parsed.events) {
      const id = await this.deps.events.insert(context, provider.id, event);
      if (!id) continue;
      await this.deps.queue.enqueue(context, id);
      accepted += 1;
    }
    return { accepted };
  }
}

export class ApplyProviderEventUseCase {
  constructor(
    private readonly deps: {
      events: InboundEventRepository;
      deliveries: DeliveryRepository;
      preferences: RecipientPreferencesRepository;
      clock: Clock;
    },
  ) {}

  async execute(context: TenantContext, eventId: string): Promise<void> {
    const event = await this.deps.events.findById(context, eventId);
    if (!event || event.processedAt) return;
    const delivery = await this.deps.deliveries.findByProviderMessageId(
      context,
      event.providerConfigId,
      event.providerMessageId,
    );
    if (delivery) {
      const base = {
        deliveryId: delivery.id,
        campaignId: delivery.campaignId,
        source: 'provider' as const,
        occurredAt: event.occurredAt,
        metadata: { providerEventId: event.providerEventId, detail: event.detail },
      };
      const contact = { id: delivery.contactId, email: delivery.email };
      switch (event.type) {
        case 'DELIVERED':
          if (
            await this.deps.deliveries.applyProviderStatus(
              context,
              delivery.id,
              'DELIVERED',
              event.occurredAt,
            )
          ) {
            await this.deps.deliveries.addEvent(context, { ...base, type: 'DELIVERED' });
          }
          break;
        case 'HARD_BOUNCE':
          await this.deps.deliveries.applyProviderStatus(
            context,
            delivery.id,
            'BOUNCED',
            event.occurredAt,
          );
          await this.deps.deliveries.addEvent(context, { ...base, type: 'BOUNCED' });
          await this.deps.preferences.suppress(context, contact, 'HARD_BOUNCE', 'provider');
          break;
        case 'SOFT_BOUNCE':
          await this.deps.deliveries.addEvent(context, {
            ...base,
            type: 'BOUNCED',
            metadata: { ...base.metadata, soft: true },
          });
          break;
        case 'COMPLAINT':
          await this.deps.deliveries.applyProviderStatus(
            context,
            delivery.id,
            'COMPLAINED',
            event.occurredAt,
          );
          await this.deps.deliveries.addEvent(context, { ...base, type: 'COMPLAINED' });
          await this.deps.preferences.suppress(context, contact, 'COMPLAINT', 'provider');
          break;
      }
    }
    await this.deps.events.markProcessed(context, eventId, this.deps.clock.now());
  }
}
