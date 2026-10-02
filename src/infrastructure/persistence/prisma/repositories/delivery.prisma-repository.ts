/**
 * Repositorio de entregas y eventos. Las transiciones de estado son actualizaciones condicionadas
 * (`WHERE status = ...`): dos workers no pueden enviar la misma entrega y un evento tardío del
 * proveedor nunca hace retroceder el estado.
 */
import {
  DELIVERY_STATUSES,
  type CampaignStats,
  type DailyActivity,
  type DeliveryForSend,
  type DeliveryStatus,
  type DeliveryView,
  type LinkStats,
  type NewDeliveryEvent,
} from '@/core/campaigns/delivery';
import type { DeliveryRepository } from '@/core/campaigns/ports';
import type { Page } from '@/core/shared/pagination';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { Prisma } from '../generated/client';
import { type PrismaClient } from '../generated/client';
import type { TenantClientCache } from '../tenant-scope.extension';
import { eligibilitySql } from './audience.sql-resolver';

const VIEW_SELECT = {
  id: true,
  email: true,
  variant: true,
  status: true,
  attempts: true,
  lastError: true,
  sentAt: true,
  firstOpenedAt: true,
  machineOpenOnly: true,
  firstClickedAt: true,
  unsubscribedAt: true,
} as const;

const PROVIDER_TRANSITIONS: Record<'DELIVERED' | 'BOUNCED' | 'COMPLAINED', DeliveryStatus[]> = {
  DELIVERED: ['SENT'],
  BOUNCED: ['SENT', 'DELIVERED'],
  COMPLAINED: ['SENT', 'DELIVERED'],
};

export class PrismaDeliveryRepository implements DeliveryRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  private scoped(context: TenantContext) {
    return this.clients.forTenant(context.tenantId);
  }

  async createBatch(
    context: TenantContext,
    campaignId: string,
    providerConfigId: string,
    rows: ReadonlyArray<{ contactId: string; email: string; variant: string | null }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.scoped(context).delivery.createMany({
      data: rows.map((row) => ({
        tenantId: context.tenantId,
        campaignId,
        providerConfigId,
        contactId: row.contactId,
        email: row.email,
        variant: row.variant,
      })),
      skipDuplicates: true,
    });
  }

  async queuedIds(
    context: TenantContext,
    campaignId: string,
    afterId: string | null,
    limit: number,
  ) {
    const rows = await this.scoped(context).delivery.findMany({
      where: { campaignId, status: 'QUEUED', ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  async queuedIdsForContacts(
    context: TenantContext,
    campaignId: string,
    contactIds: readonly string[],
  ) {
    if (contactIds.length === 0) return [];
    const rows = await this.scoped(context).delivery.findMany({
      where: { campaignId, status: 'QUEUED', contactId: { in: [...contactIds] } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findForSend(
    context: TenantContext,
    deliveryId: string,
    topicId: string | null,
  ): Promise<DeliveryForSend | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        campaignId: string;
        contactId: string;
        email: string;
        variant: string | null;
        status: DeliveryStatus;
        attempts: number;
        providerConfigId: string;
        firstName: string | null;
        lastName: string | null;
        company: string | null;
        attributes: unknown;
        eligible: boolean | null;
      }>
    >`
      SELECT d.id::text, d.campaign_id::text AS "campaignId", d.contact_id::text AS "contactId", d.email,
             d.variant, d.status::text AS status, d.attempts, d.provider_config_id::text AS "providerConfigId",
             c.first_name AS "firstName", c.last_name AS "lastName", c.company, c.attributes,
             (c.id IS NOT NULL AND ${eligibilitySql(topicId)}) AS eligible
      FROM deliveries d
      LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
      WHERE d.id = ${deliveryId}::uuid AND d.tenant_id = ${context.tenantId}::uuid`;
    const row = rows[0];
    if (!row) return null;
    const attributes =
      typeof row.attributes === 'object' &&
      row.attributes !== null &&
      !Array.isArray(row.attributes)
        ? (row.attributes as Record<string, unknown>)
        : {};
    return {
      id: row.id,
      campaignId: row.campaignId,
      contactId: row.contactId,
      email: row.email,
      variant: row.variant,
      status: row.status,
      attempts: row.attempts,
      providerConfigId: row.providerConfigId,
      recipient: {
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        company: row.company,
        attributes,
      },
      eligible: row.eligible === true,
    };
  }

  async claim(context: TenantContext, deliveryId: string, at: Date): Promise<boolean> {
    const { count } = await this.scoped(context).delivery.updateMany({
      where: { id: deliveryId, status: 'QUEUED' },
      data: { status: 'SENDING', attempts: { increment: 1 }, claimedAt: at },
    });
    return count > 0;
  }

  async release(
    context: TenantContext,
    deliveryId: string,
    lastError: string | null,
  ): Promise<void> {
    await this.scoped(context).delivery.updateMany({
      where: { id: deliveryId, status: 'SENDING' },
      data: { status: 'QUEUED', claimedAt: null, lastError: lastError?.slice(0, 500) ?? null },
    });
  }

  async markSent(context: TenantContext, deliveryId: string, providerMessageId: string, at: Date) {
    await this.scoped(context).delivery.updateMany({
      where: { id: deliveryId, status: 'SENDING' },
      data: { status: 'SENT', providerMessageId, sentAt: at, lastError: null },
    });
  }

  async markFinal(
    context: TenantContext,
    deliveryId: string,
    status: 'FAILED' | 'SUPPRESSED' | 'CANCELLED',
    lastError: string | null,
  ) {
    await this.scoped(context).delivery.updateMany({
      where: { id: deliveryId, status: { in: ['QUEUED', 'SENDING'] } },
      data: { status, lastError: lastError?.slice(0, 500) ?? null },
    });
  }

  async cancelQueued(context: TenantContext, campaignId: string): Promise<number> {
    const { count } = await this.scoped(context).delivery.updateMany({
      where: { campaignId, status: 'QUEUED' },
      data: { status: 'CANCELLED' },
    });
    return count;
  }

  countActive(context: TenantContext, campaignId: string): Promise<number> {
    return this.scoped(context).delivery.count({
      where: { campaignId, status: { in: ['QUEUED', 'SENDING'] } },
    });
  }

  count(context: TenantContext, campaignId: string): Promise<number> {
    return this.scoped(context).delivery.count({ where: { campaignId } });
  }

  async stats(context: TenantContext, campaignId: string): Promise<CampaignStats> {
    const [byStatus, totals, downloads] = await Promise.all([
      this.prisma.$queryRaw<Array<{ status: DeliveryStatus; total: number }>>`
        SELECT status::text AS status, count(*)::int AS total FROM deliveries
        WHERE tenant_id = ${context.tenantId}::uuid AND campaign_id = ${campaignId}::uuid
        GROUP BY status`,
      this.prisma.$queryRaw<
        Array<{
          total: number;
          opened: number;
          machine: number;
          clicked: number;
          unsubscribed: number;
          aSent: number;
          aOpened: number;
          aClicked: number;
          bSent: number;
          bOpened: number;
          bClicked: number;
        }>
      >`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE first_opened_at IS NOT NULL AND NOT machine_open_only)::int AS opened,
          count(*) FILTER (WHERE machine_open_only)::int AS machine,
          count(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS clicked,
          count(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed,
          count(*) FILTER (WHERE variant = 'A' AND sent_at IS NOT NULL)::int AS "aSent",
          count(*) FILTER (WHERE variant = 'A' AND first_opened_at IS NOT NULL AND NOT machine_open_only)::int AS "aOpened",
          count(*) FILTER (WHERE variant = 'A' AND first_clicked_at IS NOT NULL)::int AS "aClicked",
          count(*) FILTER (WHERE variant = 'B' AND sent_at IS NOT NULL)::int AS "bSent",
          count(*) FILTER (WHERE variant = 'B' AND first_opened_at IS NOT NULL AND NOT machine_open_only)::int AS "bOpened",
          count(*) FILTER (WHERE variant = 'B' AND first_clicked_at IS NOT NULL)::int AS "bClicked"
        FROM deliveries WHERE tenant_id = ${context.tenantId}::uuid AND campaign_id = ${campaignId}::uuid`,
      this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT count(*)::int AS total FROM delivery_events
        WHERE tenant_id = ${context.tenantId}::uuid AND campaign_id = ${campaignId}::uuid
          AND type = 'DOWNLOADED' AND NOT is_bot`,
    ]);
    const statusCounts = Object.fromEntries(
      DELIVERY_STATUSES.map((status) => [status, 0]),
    ) as Record<DeliveryStatus, number>;
    for (const row of byStatus) statusCounts[row.status] = row.total;
    const t = totals[0];
    return {
      total: t?.total ?? 0,
      byStatus: statusCounts,
      opened: t?.opened ?? 0,
      machineOpens: t?.machine ?? 0,
      clicked: t?.clicked ?? 0,
      unsubscribed: t?.unsubscribed ?? 0,
      downloads: downloads[0]?.total ?? 0,
      variants: {
        A: { sent: t?.aSent ?? 0, opened: t?.aOpened ?? 0, clicked: t?.aClicked ?? 0 },
        B: { sent: t?.bSent ?? 0, opened: t?.bOpened ?? 0, clicked: t?.bClicked ?? 0 },
      },
    };
  }

  linkStats(context: TenantContext, campaignId: string): Promise<LinkStats[]> {
    return this.prisma.$queryRaw<LinkStats[]>`
      SELECT l.id::text AS "linkId", l.position, l.url,
        count(e.id) FILTER (WHERE NOT e.is_bot)::int AS clicks,
        count(DISTINCT e.delivery_id) FILTER (WHERE NOT e.is_bot)::int AS "uniqueClicks"
      FROM campaign_links l
      LEFT JOIN delivery_events e
        ON e.link_id = l.id AND e.campaign_id = l.campaign_id AND e.type = 'CLICKED'
      WHERE l.tenant_id = ${context.tenantId}::uuid AND l.campaign_id = ${campaignId}::uuid
      GROUP BY l.id, l.position, l.url
      ORDER BY clicks DESC, l.position ASC`;
  }

  async page(
    context: TenantContext,
    campaignId: string,
    query: {
      status?: DeliveryStatus | undefined;
      search?: string | undefined;
      page: number;
      pageSize: number;
    },
  ): Promise<Page<DeliveryView>> {
    const where = {
      campaignId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { email: { contains: query.search.toLowerCase(), mode: 'insensitive' as const } }
        : {}),
    };
    const scoped = this.scoped(context);
    const [items, total] = await Promise.all([
      scoped.delivery.findMany({
        where,
        select: VIEW_SELECT,
        orderBy: { id: 'asc' },
        skip: query.page * query.pageSize,
        take: query.pageSize,
      }),
      scoped.delivery.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findStale(before: Date) {
    const rows = await this.prisma.delivery.findMany({
      where: { status: 'SENDING', claimedAt: { lt: before } },
      select: { id: true, tenantId: true },
      take: 1000,
    });
    return rows.map((row) => ({ id: row.id, tenantId: row.tenantId, tenantSlug: '' }));
  }

  findForTracking(context: TenantContext, deliveryId: string) {
    return this.scoped(context).delivery.findFirst({
      where: { id: deliveryId },
      select: { id: true, campaignId: true, contactId: true, email: true, firstOpenedAt: true },
    });
  }

  async recordOpen(context: TenantContext, deliveryId: string, at: Date, machine: boolean) {
    await this.prisma.$executeRaw`
      UPDATE deliveries SET
        open_count = open_count + 1,
        first_opened_at = COALESCE(first_opened_at, ${at}),
        machine_open_only = CASE WHEN ${machine} THEN (first_opened_at IS NULL OR machine_open_only) ELSE false END,
        updated_at = now()
      WHERE id = ${deliveryId}::uuid AND tenant_id = ${context.tenantId}::uuid`;
  }

  async recordClick(context: TenantContext, deliveryId: string, at: Date) {
    await this.prisma.$executeRaw`
      UPDATE deliveries SET
        click_count = click_count + 1,
        first_clicked_at = COALESCE(first_clicked_at, ${at}),
        machine_open_only = false,
        updated_at = now()
      WHERE id = ${deliveryId}::uuid AND tenant_id = ${context.tenantId}::uuid`;
  }

  async recordUnsubscribe(context: TenantContext, deliveryId: string, at: Date) {
    await this.scoped(context).delivery.updateMany({
      where: { id: deliveryId, unsubscribedAt: null },
      data: { unsubscribedAt: at },
    });
  }

  async addEvent(context: TenantContext, event: NewDeliveryEvent): Promise<void> {
    await this.scoped(context).deliveryEvent.create({
      data: {
        tenantId: context.tenantId,
        deliveryId: event.deliveryId,
        campaignId: event.campaignId,
        type: event.type,
        source: event.source,
        linkId: event.linkId ?? null,
        ipHash: event.ipHash ?? null,
        userAgent: event.userAgent ?? null,
        isBot: event.isBot ?? false,
        metadata: (event.metadata ?? {}) as Prisma.InputJsonObject,
        occurredAt: event.occurredAt,
      },
    });
  }

  findByProviderMessageId(
    context: TenantContext,
    providerConfigId: string,
    providerMessageId: string,
  ) {
    return this.scoped(context).delivery.findFirst({
      where: { providerConfigId, providerMessageId },
      select: { id: true, campaignId: true, contactId: true, email: true, status: true },
    });
  }

  async applyProviderStatus(
    context: TenantContext,
    deliveryId: string,
    status: 'DELIVERED' | 'BOUNCED' | 'COMPLAINED',
    at: Date,
  ): Promise<boolean> {
    const { count } = await this.scoped(context).delivery.updateMany({
      where: { id: deliveryId, status: { in: PROVIDER_TRANSITIONS[status] } },
      data: { status, ...(status === 'DELIVERED' ? { deliveredAt: at } : {}) },
    });
    return count > 0;
  }

  dailyActivity(context: TenantContext, since: Date): Promise<DailyActivity[]> {
    return this.prisma.$queryRaw<DailyActivity[]>`
      SELECT to_char(date_trunc('day', sent_at), 'YYYY-MM-DD') AS day,
        count(*)::int AS sent,
        count(*) FILTER (WHERE first_opened_at IS NOT NULL AND NOT machine_open_only)::int AS opened,
        count(*) FILTER (WHERE first_clicked_at IS NOT NULL)::int AS clicked
      FROM deliveries
      WHERE tenant_id = ${context.tenantId}::uuid AND sent_at >= ${since}
      GROUP BY 1 ORDER BY 1`;
  }
}
