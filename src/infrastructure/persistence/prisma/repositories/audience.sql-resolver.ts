/**
 * Resolución de la audiencia de una campaña en una sola consulta parametrizada:
 * (miembros de las listas OR coincidentes con algún segmento)
 *   AND NOT en las listas excluidas
 *   AND contacto ACTIVE
 *   AND sin supresión (bajas, rebotes, quejas)
 *   AND suscrito al tema (o sin decisión y tema suscrito por defecto).
 * Cada contacto aparece una vez (email único por tenant). Paginación por cursor de id.
 */
import type { CampaignAudience } from '@/core/campaigns/campaign';
import type { AudienceResolver } from '@/core/campaigns/ports';
import { buildSegmentCatalog } from '@/core/contacts/segments';
import type { ContactFieldRepository, SegmentRepository } from '@/core/contacts/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { Prisma, type PrismaClient } from '../generated/client';
import { compileSegmentRules } from '../segment-sql';

/** Condición de elegibilidad de envío sobre `contacts c` (reutilizada al enviar). */
export function eligibilitySql(topicId: string | null): Prisma.Sql {
  const topic = topicId
    ? Prisma.sql`AND COALESCE(
        (SELECT cts.subscribed FROM contact_topic_subscriptions cts WHERE cts.contact_id = c.id AND cts.topic_id = ${topicId}::uuid),
        (SELECT t.is_default FROM topics t WHERE t.id = ${topicId}::uuid),
        true)`
    : Prisma.empty;
  return Prisma.sql`c.status = 'ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.tenant_id = c.tenant_id AND s.email_normalized = c.email_normalized)
    ${topic}`;
}

export class SqlAudienceResolver implements AudienceResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly segments: SegmentRepository,
    private readonly fields: ContactFieldRepository,
  ) {}

  private async where(context: TenantContext, audience: CampaignAudience, topicId: string | null) {
    const sources: Prisma.Sql[] = [];
    if (audience.listIds.length > 0) {
      sources.push(
        Prisma.sql`EXISTS (SELECT 1 FROM list_memberships lm WHERE lm.contact_id = c.id AND lm.list_id = ANY(${audience.listIds}::uuid[]))`,
      );
    }
    if (audience.segmentIds.length > 0) {
      const catalog = buildSegmentCatalog(await this.fields.list(context));
      const now = new Date();
      for (const segmentId of audience.segmentIds) {
        const segment = await this.segments.findById(context, segmentId);
        if (segment)
          sources.push(Prisma.sql`(${compileSegmentRules(segment.rules, catalog, now)})`);
      }
    }
    if (sources.length === 0) return null;
    const excluded =
      audience.excludeListIds.length > 0
        ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM list_memberships lx WHERE lx.contact_id = c.id AND lx.list_id = ANY(${audience.excludeListIds}::uuid[]))`
        : Prisma.empty;
    return Prisma.sql`c.tenant_id = ${context.tenantId}::uuid
      AND (${Prisma.join(sources, ' OR ')})
      ${excluded}
      AND ${eligibilitySql(topicId)}`;
  }

  async count(
    context: TenantContext,
    audience: CampaignAudience,
    topicId: string | null,
  ): Promise<number> {
    const where = await this.where(context, audience, topicId);
    if (!where) return 0;
    const rows = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total FROM contacts c WHERE ${where}`;
    return rows[0]?.total ?? 0;
  }

  async page(
    context: TenantContext,
    audience: CampaignAudience,
    topicId: string | null,
    afterContactId: string | null,
    limit: number,
  ): Promise<Array<{ contactId: string; email: string }>> {
    const where = await this.where(context, audience, topicId);
    if (!where) return [];
    const cursor = afterContactId ? Prisma.sql`AND c.id > ${afterContactId}::uuid` : Prisma.empty;
    return this.prisma.$queryRaw<Array<{ contactId: string; email: string }>>`
      SELECT c.id::text AS "contactId", c.email FROM contacts c
      WHERE ${where} ${cursor}
      ORDER BY c.id
      LIMIT ${limit}`;
  }
}
