/** Dobles en memoria de los puertos de webhooks salientes. */
import type { TenantContext } from '@/core/shared/tenant-context';
import type {
  StoredWebhookEndpoint,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookEndpointRepository,
  EventPublisher,
  WebhookEndpointWrite,
  WebhookEventType,
  WebhookQueue,
  WebhookSender,
  WebhookSendResult,
} from '@/core/webhooks/webhook';

export class InMemoryWebhookEndpointRepository implements WebhookEndpointRepository {
  readonly endpoints = new Map<string, StoredWebhookEndpoint>();

  private view({ secretEnc: _secret, ...endpoint }: StoredWebhookEndpoint) {
    return endpoint;
  }

  async list() {
    return [...this.endpoints.values()].map((endpoint) => this.view(endpoint));
  }

  async findById(_context: TenantContext, id: string) {
    return this.endpoints.get(id) ?? null;
  }

  async create(
    _context: TenantContext,
    input: WebhookEndpointWrite & { id: string; secretEnc: string; createdById: string },
  ) {
    const { createdById: _createdBy, ...data } = input;
    const endpoint: StoredWebhookEndpoint = {
      ...data,
      failureCount: 0,
      lastStatus: null,
      lastError: null,
      lastDeliveryAt: null,
      createdAt: new Date(),
    };
    this.endpoints.set(endpoint.id, endpoint);
    return this.view(endpoint);
  }

  async update(
    _context: TenantContext,
    id: string,
    patch: Partial<WebhookEndpointWrite> & { secretEnc?: string },
  ) {
    const current = this.endpoints.get(id);
    if (!current) return false;
    this.endpoints.set(id, {
      ...current,
      ...patch,
      failureCount: patch.enabled ? 0 : current.failureCount,
    });
    return true;
  }

  async delete(_context: TenantContext, id: string) {
    return this.endpoints.delete(id);
  }

  async findSubscribed(_context: TenantContext, eventType: string) {
    return [...this.endpoints.values()]
      .filter(
        (endpoint) =>
          endpoint.enabled && endpoint.events.some((subscribed) => subscribed === eventType),
      )
      .map((endpoint) => this.view(endpoint));
  }

  async recordResult(
    _context: TenantContext,
    id: string,
    result: {
      ok: boolean;
      status: number | null;
      error: string | null;
      at: Date;
      disableAfter: number;
    },
  ) {
    const current = this.endpoints.get(id);
    if (!current) return;
    const failureCount = result.ok ? 0 : current.failureCount + 1;
    this.endpoints.set(id, {
      ...current,
      failureCount,
      enabled: current.enabled && failureCount < result.disableAfter,
      lastStatus: result.status,
      lastError: result.error,
      lastDeliveryAt: result.at,
    });
  }
}

export class InMemoryWebhookDeliveryRepository implements WebhookDeliveryRepository {
  readonly deliveries = new Map<string, WebhookDeliveryRecord>();

  async createMany(
    _context: TenantContext,
    rows: ReadonlyArray<{
      id: string;
      endpointId: string;
      eventId: string;
      eventType: string;
      payload: Record<string, unknown>;
    }>,
  ) {
    for (const row of rows) {
      this.deliveries.set(row.id, {
        ...row,
        status: 'PENDING',
        attempts: 0,
        responseStatus: null,
        error: null,
        createdAt: new Date('2026-10-02T12:00:00.000Z'),
        deliveredAt: null,
      });
    }
  }

  async findById(_context: TenantContext, id: string) {
    return this.deliveries.get(id) ?? null;
  }

  async update(
    _context: TenantContext,
    id: string,
    patch: Pick<
      WebhookDeliveryRecord,
      'status' | 'attempts' | 'responseStatus' | 'error' | 'deliveredAt'
    >,
  ) {
    const current = this.deliveries.get(id);
    if (current) this.deliveries.set(id, { ...current, ...patch });
  }

  async listByEndpoint(_context: TenantContext, endpointId: string, limit: number) {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.endpointId === endpointId)
      .slice(0, limit);
  }
}

export class RecordingWebhookQueue implements WebhookQueue {
  readonly enqueued: string[] = [];
  async enqueue(_context: TenantContext, deliveryIds: readonly string[]) {
    this.enqueued.push(...deliveryIds);
  }
}

export class ScriptedWebhookSender implements WebhookSender {
  readonly calls: Array<{ url: string; body: string; secret: string }> = [];
  constructor(public result: WebhookSendResult = { status: 200, error: null }) {}
  async send(url: string, body: string, secret: string) {
    this.calls.push({ url, body, secret });
    return this.result;
  }
}

export class RecordingEventPublisher implements EventPublisher {
  readonly published: Array<{ type: WebhookEventType; data: Record<string, unknown> }> = [];
  async publish(_context: TenantContext, type: WebhookEventType, data: Record<string, unknown>) {
    this.published.push({ type, data });
  }
}
