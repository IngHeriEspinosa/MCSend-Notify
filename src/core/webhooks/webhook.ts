/**
 * Webhooks salientes: el tenant registra destinos (URL) y elige qué eventos recibir. Cada evento
 * se envía firmado (HMAC-SHA256 de `{timestamp}.{cuerpo}`) con reintentos; un destino que falla
 * de forma continuada se desactiva solo para no acumular trabajo inútil.
 */
import { z } from 'zod';
import type { TenantContext } from '@/core/shared/tenant-context';

export const WEBHOOK_EVENT_TYPES = [
  'campaign.sent',
  'campaign.approval_requested',
  'delivery.bounced',
  'delivery.complained',
  'contact.unsubscribed',
  'automation.run_failed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** Evento de prueba ("Enviar prueba"): solo se envía al destino elegido. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

export const MAX_WEBHOOK_ENDPOINTS = 10;
/** Fallos definitivos consecutivos tras los que el destino se desactiva. */
export const WEBHOOK_AUTO_DISABLE_AFTER = 20;
export const WEBHOOK_SIGNATURE_HEADER = 'x-mcsn-signature';

export const webhookEndpointInputSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(500),
  description: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1).max(WEBHOOK_EVENT_TYPES.length),
  enabled: z.boolean().default(true),
});
export type WebhookEndpointInput = z.infer<typeof webhookEndpointInputSchema>;

export interface WebhookEndpointView {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEventType[];
  enabled: boolean;
  failureCount: number;
  lastStatus: number | null;
  lastError: string | null;
  lastDeliveryAt: Date | null;
  createdAt: Date;
}

export interface StoredWebhookEndpoint extends WebhookEndpointView {
  secretEnc: string;
}

export const WEBHOOK_DELIVERY_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED'] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export interface WebhookDeliveryView {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export interface WebhookDeliveryRecord extends WebhookDeliveryView {
  payload: Record<string, unknown>;
}

export function webhookSecretAad(tenantId: string, endpointId: string): string {
  return `${tenantId}:webhook_endpoint:${endpointId}`;
}

// ---------------------------------------------------------------------------
// Puertos
// ---------------------------------------------------------------------------

export interface WebhookEndpointWrite {
  url: string;
  description: string | null;
  events: WebhookEventType[];
  enabled: boolean;
}

export interface WebhookEndpointRepository {
  list(context: TenantContext): Promise<WebhookEndpointView[]>;
  findById(context: TenantContext, endpointId: string): Promise<StoredWebhookEndpoint | null>;
  create(
    context: TenantContext,
    input: WebhookEndpointWrite & { id: string; secretEnc: string; createdById: string },
  ): Promise<WebhookEndpointView>;
  update(
    context: TenantContext,
    endpointId: string,
    patch: Partial<WebhookEndpointWrite> & { secretEnc?: string },
  ): Promise<boolean>;
  delete(context: TenantContext, endpointId: string): Promise<boolean>;
  /** Destinos activos suscritos a un tipo de evento. */
  findSubscribed(context: TenantContext, eventType: string): Promise<WebhookEndpointView[]>;
  /**
   * Registra el resultado de un envío: un éxito pone a cero los fallos; un fallo definitivo los
   * incrementa y desactiva el destino al llegar a `disableAfter`.
   */
  recordResult(
    context: TenantContext,
    endpointId: string,
    result: {
      ok: boolean;
      status: number | null;
      error: string | null;
      at: Date;
      disableAfter: number;
    },
  ): Promise<void>;
}

export interface WebhookDeliveryRepository {
  createMany(
    context: TenantContext,
    rows: ReadonlyArray<{
      id: string;
      endpointId: string;
      eventId: string;
      eventType: string;
      payload: Record<string, unknown>;
    }>,
  ): Promise<void>;
  findById(context: TenantContext, deliveryId: string): Promise<WebhookDeliveryRecord | null>;
  update(
    context: TenantContext,
    deliveryId: string,
    patch: {
      status: WebhookDeliveryStatus;
      attempts: number;
      responseStatus: number | null;
      error: string | null;
      deliveredAt: Date | null;
    },
  ): Promise<void>;
  listByEndpoint(
    context: TenantContext,
    endpointId: string,
    limit: number,
  ): Promise<WebhookDeliveryView[]>;
}

export interface WebhookQueue {
  enqueue(context: TenantContext, deliveryIds: readonly string[]): Promise<void>;
}

export interface WebhookSendResult {
  status: number | null;
  error: string | null;
}

/** Envío HTTP con protección SSRF y firma (infraestructura). */
export interface WebhookSender {
  send(
    url: string,
    body: string,
    secret: string,
    meta: { eventId: string; eventType: string; deliveryId: string; timestamp: number },
  ): Promise<WebhookSendResult>;
}

/** Publicación de eventos de negocio hacia los webhooks del tenant. Nunca lanza. */
export interface EventPublisher {
  publish(
    context: TenantContext,
    type: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void>;
}

export const noopEventPublisher: EventPublisher = { publish: async () => {} };
