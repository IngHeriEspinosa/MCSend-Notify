/**
 * Casos de uso de webhooks salientes: gestión de destinos, publicación de eventos y entrega
 * con reintentos.
 *
 * El secreto de firma se genera en el servidor, se muestra una sola vez y se guarda cifrado con
 * AAD por fila. La publicación nunca interrumpe la operación de negocio que la origina: si falla,
 * se informa por `onError` y el flujo principal continúa.
 */
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock, IdGenerator, SecretCipher, SecretTokenService } from '@/core/shared/ports';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import {
  MAX_WEBHOOK_ENDPOINTS,
  WEBHOOK_AUTO_DISABLE_AFTER,
  WEBHOOK_TEST_EVENT,
  webhookSecretAad,
  type EventPublisher,
  type WebhookDeliveryRepository,
  type WebhookEndpointInput,
  type WebhookEndpointRepository,
  type WebhookEndpointView,
  type WebhookEventType,
  type WebhookQueue,
  type WebhookSender,
} from './webhook';

export const WEBHOOK_DELIVERY_ATTEMPTS = 8;
const DELIVERIES_LISTED = 50;

const RETRYABLE_ERROR_BRAND = Symbol.for('mc-send-notify.WebhookRetryError');

/** Error transitorio de entrega: la cola reintenta el job con backoff. */
export class WebhookRetryError extends Error {
  readonly [RETRYABLE_ERROR_BRAND] = true;

  constructor(message: string) {
    super(message);
    this.name = 'WebhookRetryError';
  }
}

/** Reintento esperado (destino caído): el worker lo registra como aviso, no como error. */
export function isWebhookRetryError(error: unknown): error is WebhookRetryError {
  return typeof error === 'object' && error !== null && RETRYABLE_ERROR_BRAND in error;
}

export interface WebhookDeps {
  endpoints: WebhookEndpointRepository;
  deliveries: WebhookDeliveryRepository;
  queue: WebhookQueue;
  cipher: SecretCipher;
  tokens: SecretTokenService;
  audit: AuditLogger;
  clock: Clock;
  ids: IdGenerator;
  /** Notificación de errores de publicación (logs); la publicación nunca lanza. */
  onError?: (error: unknown, context: TenantContext, eventType: string) => void;
}

export class WebhookPublisher implements EventPublisher {
  constructor(private readonly deps: WebhookDeps) {}

  async publish(context: TenantContext, type: WebhookEventType, data: Record<string, unknown>) {
    try {
      const endpoints = await this.deps.endpoints.findSubscribed(context, type);
      await this.enqueue(context, endpoints, type, data);
    } catch (error) {
      this.deps.onError?.(error, context, type);
    }
  }

  /** Crea una entrega por destino con el mismo id de evento y las encola. */
  async enqueue(
    context: TenantContext,
    endpoints: readonly Pick<WebhookEndpointView, 'id'>[],
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (endpoints.length === 0) return;
    const eventId = this.deps.ids.uuid();
    const rows = endpoints.map((endpoint) => ({
      id: this.deps.ids.uuid(),
      endpointId: endpoint.id,
      eventId,
      eventType: type,
      payload: data,
    }));
    await this.deps.deliveries.createMany(context, rows);
    await this.deps.queue.enqueue(
      context,
      rows.map((row) => row.id),
    );
  }
}

export class ManageWebhooksUseCase {
  private readonly publisher: WebhookPublisher;

  constructor(private readonly deps: WebhookDeps) {
    this.publisher = new WebhookPublisher(deps);
  }

  list(context: TenantContext) {
    assertCan(context, 'webhook:manage');
    return this.deps.endpoints.list(context);
  }

  async deliveries(context: TenantContext, endpointId: string) {
    await this.get(context, endpointId);
    return this.deps.deliveries.listByEndpoint(context, endpointId, DELIVERIES_LISTED);
  }

  /** Crea el destino y devuelve el secreto de firma (solo esta vez). */
  async create(context: TenantContext, input: WebhookEndpointInput) {
    assertCan(context, 'webhook:manage');
    const userId = actorUserId(context);
    if (!userId) throw new DomainError('FORBIDDEN', 'Solo un usuario gestiona webhooks');
    if ((await this.deps.endpoints.list(context)).length >= MAX_WEBHOOK_ENDPOINTS) {
      throw new DomainError('VALIDATION', 'Máximo de destinos alcanzado', {
        reason: 'WEBHOOK_LIMIT',
      });
    }
    const id = this.deps.ids.uuid();
    const secret = this.newSecret();
    const endpoint = await this.deps.endpoints.create(context, {
      ...input,
      id,
      secretEnc: this.deps.cipher.encrypt(secret, webhookSecretAad(context.tenantId, id)),
      createdById: userId,
    });
    await this.audit(context, 'webhook.created', id, { events: input.events });
    return { endpoint, secret };
  }

  async update(context: TenantContext, endpointId: string, input: WebhookEndpointInput) {
    await this.get(context, endpointId);
    await this.deps.endpoints.update(context, endpointId, input);
    await this.audit(context, 'webhook.updated', endpointId, { events: input.events });
  }

  async rotateSecret(context: TenantContext, endpointId: string) {
    await this.get(context, endpointId);
    const secret = this.newSecret();
    await this.deps.endpoints.update(context, endpointId, {
      secretEnc: this.deps.cipher.encrypt(secret, webhookSecretAad(context.tenantId, endpointId)),
    });
    await this.audit(context, 'webhook.secret_rotated', endpointId);
    return { secret };
  }

  async delete(context: TenantContext, endpointId: string) {
    assertCan(context, 'webhook:manage');
    if (!(await this.deps.endpoints.delete(context, endpointId))) {
      throw new DomainError('NOT_FOUND', 'Destino inexistente');
    }
    await this.audit(context, 'webhook.deleted', endpointId);
  }

  /** Envía un evento de prueba solo a este destino. */
  async sendTest(context: TenantContext, endpointId: string) {
    const endpoint = await this.get(context, endpointId);
    await this.publisher.enqueue(context, [endpoint], WEBHOOK_TEST_EVENT, {
      message: 'Prueba de MC Send Notify',
      sentAt: this.deps.clock.now().toISOString(),
    });
  }

  private async get(context: TenantContext, endpointId: string) {
    assertCan(context, 'webhook:manage');
    const endpoint = await this.deps.endpoints.findById(context, endpointId);
    if (!endpoint) throw new DomainError('NOT_FOUND', 'Destino inexistente');
    return endpoint;
  }

  private newSecret(): string {
    return `whsec_${this.deps.tokens.generate().token}`;
  }

  private audit(
    context: TenantContext,
    action: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.deps.audit.record(context, {
      action,
      entityType: 'webhook_endpoint',
      entityId,
      ...(metadata ? { metadata } : {}),
    });
  }
}

export interface DeliverWebhookDeps {
  endpoints: WebhookEndpointRepository;
  deliveries: WebhookDeliveryRepository;
  sender: WebhookSender;
  cipher: SecretCipher;
  clock: Clock;
}

/** Entrega de un evento a un destino (worker). Lanza WebhookRetryError si debe reintentarse. */
export class DeliverWebhookUseCase {
  constructor(private readonly deps: DeliverWebhookDeps) {}

  async execute(
    context: TenantContext,
    deliveryId: string,
    options: { attempt: number; finalAttempt: boolean },
  ): Promise<void> {
    const delivery = await this.deps.deliveries.findById(context, deliveryId);
    if (!delivery || delivery.status !== 'PENDING') return;
    const endpoint = await this.deps.endpoints.findById(context, delivery.endpointId);
    const now = this.deps.clock.now();
    if (!endpoint?.enabled) {
      await this.deps.deliveries.update(context, deliveryId, {
        status: 'FAILED',
        attempts: options.attempt,
        responseStatus: null,
        error: 'ENDPOINT_DISABLED',
        deliveredAt: null,
      });
      return;
    }

    const body = JSON.stringify({
      id: delivery.eventId,
      type: delivery.eventType,
      createdAt: delivery.createdAt.toISOString(),
      tenant: context.tenantSlug,
      data: delivery.payload,
    });
    let secret: string;
    try {
      secret = this.deps.cipher.decrypt(
        endpoint.secretEnc,
        webhookSecretAad(context.tenantId, endpoint.id),
      );
    } catch {
      // Clave de cifrado retirada o dato corrupto: reintentar no lo arregla (rotar el secreto sí).
      await this.deps.deliveries.update(context, deliveryId, {
        status: 'FAILED',
        attempts: options.attempt,
        responseStatus: null,
        error: 'SECRET_UNREADABLE',
        deliveredAt: null,
      });
      return;
    }
    const result = await this.deps.sender.send(endpoint.url, body, secret, {
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      deliveryId,
      timestamp: Math.floor(now.getTime() / 1000),
    });
    const ok = result.status !== null && result.status >= 200 && result.status < 300;

    if (ok || options.finalAttempt) {
      await this.deps.deliveries.update(context, deliveryId, {
        status: ok ? 'SUCCEEDED' : 'FAILED',
        attempts: options.attempt,
        responseStatus: result.status,
        error: ok ? null : (result.error ?? `HTTP ${result.status}`),
        deliveredAt: ok ? now : null,
      });
      await this.deps.endpoints.recordResult(context, endpoint.id, {
        ok,
        status: result.status,
        error: ok ? null : (result.error ?? `HTTP ${result.status}`),
        at: now,
        disableAfter: WEBHOOK_AUTO_DISABLE_AFTER,
      });
      return;
    }

    await this.deps.deliveries.update(context, deliveryId, {
      status: 'PENDING',
      attempts: options.attempt,
      responseStatus: result.status,
      error: result.error ?? `HTTP ${result.status}`,
      deliveredAt: null,
    });
    throw new WebhookRetryError(result.error ?? `HTTP ${result.status}`);
  }
}
