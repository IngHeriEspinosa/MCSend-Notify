/**
 * Repositorios de webhooks salientes: destinos (con secreto cifrado, nunca expuesto en las
 * vistas) y registro de entregas.
 */
import {
  WEBHOOK_EVENT_TYPES,
  type StoredWebhookEndpoint,
  type WebhookDeliveryRecord,
  type WebhookDeliveryRepository,
  type WebhookDeliveryStatus,
  type WebhookDeliveryView,
  type WebhookEndpointRepository,
  type WebhookEndpointView,
  type WebhookEndpointWrite,
  type WebhookEventType,
} from '@/core/webhooks/webhook';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { Prisma } from '../generated/client';
import type { TenantClientCache } from '../tenant-scope.extension';

const ENDPOINT_SELECT = {
  id: true,
  url: true,
  description: true,
  events: true,
  enabled: true,
  failureCount: true,
  lastStatus: true,
  lastError: true,
  lastDeliveryAt: true,
  createdAt: true,
} as const;

type EndpointRow = Prisma.WebhookEndpointGetPayload<{ select: typeof ENDPOINT_SELECT }>;

const isEventType = (value: string): value is WebhookEventType =>
  WEBHOOK_EVENT_TYPES.some((type) => type === value);

function toView(row: EndpointRow): WebhookEndpointView {
  return { ...row, events: row.events.filter(isEventType) };
}

export class PrismaWebhookEndpointRepository implements WebhookEndpointRepository {
  constructor(private readonly clients: TenantClientCache) {}

  private scoped(context: TenantContext) {
    return this.clients.forTenant(context.tenantId);
  }

  async list(context: TenantContext): Promise<WebhookEndpointView[]> {
    const rows = await this.scoped(context).webhookEndpoint.findMany({
      select: ENDPOINT_SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toView);
  }

  async findById(
    context: TenantContext,
    endpointId: string,
  ): Promise<StoredWebhookEndpoint | null> {
    const row = await this.scoped(context).webhookEndpoint.findFirst({
      where: { id: endpointId },
      select: { ...ENDPOINT_SELECT, secretEnc: true },
    });
    return row ? { ...toView(row), secretEnc: row.secretEnc } : null;
  }

  async create(
    context: TenantContext,
    input: WebhookEndpointWrite & { id: string; secretEnc: string; createdById: string },
  ): Promise<WebhookEndpointView> {
    const row = await this.scoped(context).webhookEndpoint.create({
      data: { ...input, tenantId: context.tenantId },
      select: ENDPOINT_SELECT,
    });
    return toView(row);
  }

  async update(
    context: TenantContext,
    endpointId: string,
    patch: Partial<WebhookEndpointWrite> & { secretEnc?: string },
  ): Promise<boolean> {
    // Reactivar un destino desactivado por fallos reinicia el contador.
    const data = patch.enabled ? { ...patch, failureCount: 0 } : patch;
    const { count } = await this.scoped(context).webhookEndpoint.updateMany({
      where: { id: endpointId },
      data,
    });
    return count > 0;
  }

  async delete(context: TenantContext, endpointId: string): Promise<boolean> {
    const { count } = await this.scoped(context).webhookEndpoint.deleteMany({
      where: { id: endpointId },
    });
    return count > 0;
  }

  async findSubscribed(context: TenantContext, eventType: string): Promise<WebhookEndpointView[]> {
    const rows = await this.scoped(context).webhookEndpoint.findMany({
      where: { enabled: true, events: { has: eventType } },
      select: ENDPOINT_SELECT,
    });
    return rows.map(toView);
  }

  async recordResult(
    context: TenantContext,
    endpointId: string,
    result: {
      ok: boolean;
      status: number | null;
      error: string | null;
      at: Date;
      disableAfter: number;
    },
  ): Promise<void> {
    const scoped = this.scoped(context);
    const common = {
      lastStatus: result.status,
      lastError: result.error?.slice(0, 500) ?? null,
      lastDeliveryAt: result.at,
    };
    if (result.ok) {
      await scoped.webhookEndpoint.updateMany({
        where: { id: endpointId },
        data: { ...common, failureCount: 0 },
      });
      return;
    }
    await scoped.webhookEndpoint.updateMany({
      where: { id: endpointId },
      data: { ...common, failureCount: { increment: 1 } },
    });
    await scoped.webhookEndpoint.updateMany({
      where: { id: endpointId, failureCount: { gte: result.disableAfter } },
      data: { enabled: false },
    });
  }
}

const DELIVERY_SELECT = {
  id: true,
  endpointId: true,
  eventId: true,
  eventType: true,
  status: true,
  attempts: true,
  responseStatus: true,
  error: true,
  createdAt: true,
  deliveredAt: true,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class PrismaWebhookDeliveryRepository implements WebhookDeliveryRepository {
  constructor(private readonly clients: TenantClientCache) {}

  private scoped(context: TenantContext) {
    return this.clients.forTenant(context.tenantId);
  }

  async createMany(
    context: TenantContext,
    rows: ReadonlyArray<{
      id: string;
      endpointId: string;
      eventId: string;
      eventType: string;
      payload: Record<string, unknown>;
    }>,
  ): Promise<void> {
    await this.scoped(context).webhookDelivery.createMany({
      data: rows.map((row) => ({
        ...row,
        tenantId: context.tenantId,
        payload: row.payload as Prisma.InputJsonValue,
      })),
    });
  }

  async findById(
    context: TenantContext,
    deliveryId: string,
  ): Promise<WebhookDeliveryRecord | null> {
    const row = await this.scoped(context).webhookDelivery.findFirst({
      where: { id: deliveryId },
      select: { ...DELIVERY_SELECT, payload: true },
    });
    if (!row) return null;
    return { ...row, payload: isRecord(row.payload) ? row.payload : {} };
  }

  async update(
    context: TenantContext,
    deliveryId: string,
    patch: {
      status: WebhookDeliveryStatus;
      attempts: number;
      responseStatus: number | null;
      error: string | null;
      deliveredAt: Date | null;
    },
  ): Promise<void> {
    await this.scoped(context).webhookDelivery.updateMany({
      where: { id: deliveryId },
      data: { ...patch, error: patch.error?.slice(0, 500) ?? null },
    });
  }

  listByEndpoint(
    context: TenantContext,
    endpointId: string,
    limit: number,
  ): Promise<WebhookDeliveryView[]> {
    return this.scoped(context).webhookDelivery.findMany({
      where: { endpointId },
      select: DELIVERY_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
