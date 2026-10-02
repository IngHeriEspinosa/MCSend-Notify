/**
 * Repositorio de contactos.
 * - CRUD con el cliente acotado al tenant.
 * - Consultas con segmento y upsert por lotes en SQL parametrizado, que filtran por
 *   `tenant_id` de forma explícita (el SQL en bruto no pasa por la extensión de tenant).
 */
import type {
  ContactDetail,
  ContactQuery,
  ContactStatus,
  ContactSummary,
  ContactWriteData,
} from '@/core/contacts/contact';
import type { AttributeValue } from '@/core/contacts/contact-fields';
import type {
  ContactRelations,
  ContactRepository,
  DuplicatePolicy,
  ResolvedSegmentFilter,
  UpsertBatchResult,
} from '@/core/contacts/ports';
import { DomainError } from '@/core/shared/domain-error';
import type { Page } from '@/core/shared/pagination';
import type { TenantContext } from '@/core/shared/tenant-context';
import { Prisma, type PrismaClient } from '../generated/client';
import { isUniqueViolation } from '../prisma-errors';
import { compileSegmentRules, escapeLike } from '../segment-sql';
import type { TenantClientCache, TenantScopedPrisma } from '../tenant-scope.extension';

type ContactQueryFilters = Omit<ContactQuery, 'segmentId'>;

const SUMMARY_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  company: true,
  status: true,
  source: true,
  createdAt: true,
} as const;

const SORT_SQL: Record<ContactQuery['sortField'], string> = {
  createdAt: 'c.created_at',
  email: 'c.email_normalized',
  firstName: 'c.first_name',
  lastName: 'c.last_name',
  company: 'c.company',
};

function toAttributes(value: unknown): Record<string, AttributeValue> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, AttributeValue] =>
        typeof entry[1] === 'string' ||
        typeof entry[1] === 'number' ||
        typeof entry[1] === 'boolean',
    ),
  );
}

function buildWhere(query: ContactQueryFilters): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {};
  if (query.search) {
    where.OR = [
      { emailNormalized: { contains: query.search.toLowerCase() } },
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
      { company: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.status) where.status = query.status;
  if (query.listId) where.listMemberships = { some: { listId: query.listId } };
  if (query.tagId) where.tags = { some: { tagId: query.tagId } };
  return where;
}

function buildSqlFilters(
  context: TenantContext,
  query: ContactQueryFilters,
  segment: ResolvedSegmentFilter,
) {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`c.tenant_id = ${context.tenantId}::uuid`,
    compileSegmentRules(segment.rules, segment.catalog, segment.now),
  ];
  if (query.search) {
    const pattern = `%${escapeLike(query.search)}%`;
    conditions.push(
      Prisma.sql`(c.email_normalized ILIKE ${pattern} ESCAPE '\\' OR c.first_name ILIKE ${pattern} ESCAPE '\\' OR c.last_name ILIKE ${pattern} ESCAPE '\\' OR c.company ILIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (query.status) conditions.push(Prisma.sql`c.status::text = ${query.status}`);
  if (query.listId) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM list_memberships lm WHERE lm.contact_id = c.id AND lm.list_id = ${query.listId}::uuid)`,
    );
  }
  if (query.tagId) {
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ${query.tagId}::uuid)`,
    );
  }
  return Prisma.join(conditions, ' AND ');
}

function writeColumns(data: ContactWriteData) {
  return {
    email: data.email,
    emailNormalized: data.emailNormalized,
    firstName: data.firstName ?? null,
    lastName: data.lastName ?? null,
    company: data.company ?? null,
    locale: data.locale ?? null,
    timezone: data.timezone ?? null,
    externalId: data.externalId ?? null,
    attributes: data.attributes,
    ...(data.status ? { status: data.status } : {}),
    ...(data.source ? { source: data.source } : {}),
    ...(data.consentAt !== undefined ? { consentAt: data.consentAt } : {}),
    ...(data.consentSource !== undefined ? { consentSource: data.consentSource } : {}),
  };
}

type TransactionClient = Parameters<Parameters<TenantScopedPrisma['$transaction']>[0]>[0];

async function replaceRelations(
  tx: TransactionClient,
  tenantId: string,
  contactId: string,
  relations: ContactRelations,
): Promise<void> {
  if (relations.listIds) {
    await tx.listMembership.deleteMany({
      where: { contactId, listId: { notIn: relations.listIds } },
    });
    await tx.listMembership.createMany({
      data: relations.listIds.map((listId) => ({ tenantId, listId, contactId, source: 'manual' })),
      skipDuplicates: true,
    });
  }
  if (relations.tagIds) {
    await tx.contactTag.deleteMany({ where: { contactId, tagId: { notIn: relations.tagIds } } });
    await tx.contactTag.createMany({
      data: relations.tagIds.map((tagId) => ({ tenantId, tagId, contactId })),
      skipDuplicates: true,
    });
  }
  for (const [topicId, subscribed] of Object.entries(relations.topicSubscriptions ?? {})) {
    await tx.contactTopicSubscription.upsert({
      where: { contactId_topicId: { contactId, topicId } },
      create: { tenantId, contactId, topicId, subscribed },
      update: { subscribed },
    });
  }
}

export class PrismaContactRepository implements ContactRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  async list(
    context: TenantContext,
    query: ContactQueryFilters,
    segment?: ResolvedSegmentFilter,
  ): Promise<Page<ContactSummary>> {
    const scoped = this.clients.forTenant(context.tenantId);
    const skip = query.page * query.pageSize;

    if (!segment) {
      const where = buildWhere(query);
      const [items, total] = await Promise.all([
        scoped.contact.findMany({
          where,
          select: SUMMARY_SELECT,
          orderBy: [{ [query.sortField]: query.sortDirection }, { id: 'asc' }],
          skip,
          take: query.pageSize,
        }),
        scoped.contact.count({ where }),
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    }

    const filters = buildSqlFilters(context, query, segment);
    const order = Prisma.raw(
      `${SORT_SQL[query.sortField]} ${query.sortDirection === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, c.id ASC`,
    );
    const [idRows, countRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT c.id FROM contacts c WHERE ${filters} ORDER BY ${order} LIMIT ${query.pageSize} OFFSET ${skip}`,
      this.prisma.$queryRaw<Array<{ total: number }>>`
        SELECT count(*)::int AS total FROM contacts c WHERE ${filters}`,
    ]);
    const ids = idRows.map((row) => row.id);
    const rows = await scoped.contact.findMany({
      where: { id: { in: ids } },
      select: SUMMARY_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      items: ids
        .map((id) => byId.get(id))
        .filter((row): row is ContactSummary => row !== undefined),
      total: countRows[0]?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async findById(context: TenantContext, contactId: string): Promise<ContactDetail | null> {
    const row = await this.clients.forTenant(context.tenantId).contact.findFirst({
      where: { id: contactId },
      include: {
        listMemberships: { select: { listId: true } },
        tags: { select: { tagId: true } },
        topicSubscriptions: { select: { topicId: true, subscribed: true } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      company: row.company,
      status: row.status as ContactStatus,
      source: row.source,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      locale: row.locale,
      timezone: row.timezone,
      externalId: row.externalId,
      attributes: toAttributes(row.attributes),
      consentAt: row.consentAt,
      consentSource: row.consentSource,
      listIds: row.listMemberships.map((membership) => membership.listId),
      tagIds: row.tags.map((tag) => tag.tagId),
      topicSubscriptions: Object.fromEntries(
        row.topicSubscriptions.map((subscription) => [
          subscription.topicId,
          subscription.subscribed,
        ]),
      ),
    };
  }

  async findIdByEmail(context: TenantContext, emailNormalized: string): Promise<string | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .contact.findFirst({ where: { emailNormalized }, select: { id: true } });
    return row?.id ?? null;
  }

  async create(
    context: TenantContext,
    data: ContactWriteData,
    relations: ContactRelations,
  ): Promise<ContactDetail> {
    const scoped = this.clients.forTenant(context.tenantId);
    const id = await this.mapConflicts(context, data, () =>
      scoped.$transaction(async (tx) => {
        const contact = await tx.contact.create({
          data: { ...writeColumns(data), tenantId: context.tenantId },
          select: { id: true },
        });
        await replaceRelations(tx, context.tenantId, contact.id, relations);
        return contact.id;
      }),
    );
    return this.requireDetail(context, id);
  }

  async update(
    context: TenantContext,
    contactId: string,
    data: ContactWriteData,
    relations: ContactRelations,
  ): Promise<ContactDetail> {
    const scoped = this.clients.forTenant(context.tenantId);
    await this.mapConflicts(
      context,
      data,
      () =>
        scoped.$transaction(async (tx) => {
          const { count } = await tx.contact.updateMany({
            where: { id: contactId },
            data: writeColumns(data),
          });
          if (count === 0) throw new DomainError('NOT_FOUND', 'Contacto inexistente');
          await replaceRelations(tx, context.tenantId, contactId, relations);
        }),
      contactId,
    );
    return this.requireDetail(context, contactId);
  }

  async delete(context: TenantContext, contactId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .contact.deleteMany({ where: { id: contactId } });
    return count > 0;
  }

  async upsertBatch(
    context: TenantContext,
    rows: ContactWriteData[],
    policy: DuplicatePolicy,
  ): Promise<UpsertBatchResult> {
    if (rows.length === 0) return { created: 0, updated: 0, skipped: 0, contactIds: [] };
    const tenantId = context.tenantId;
    const rowsWithSafeExternalIds = await this.dropConflictingExternalIds(tenantId, rows);
    const column = <T>(pick: (row: ContactWriteData) => T) => rowsWithSafeExternalIds.map(pick);

    const conflict =
      policy === 'UPDATE'
        ? Prisma.sql`DO UPDATE SET
            email = EXCLUDED.email,
            first_name = COALESCE(EXCLUDED.first_name, contacts.first_name),
            last_name = COALESCE(EXCLUDED.last_name, contacts.last_name),
            company = COALESCE(EXCLUDED.company, contacts.company),
            locale = COALESCE(EXCLUDED.locale, contacts.locale),
            timezone = COALESCE(EXCLUDED.timezone, contacts.timezone),
            external_id = COALESCE(contacts.external_id, EXCLUDED.external_id),
            attributes = contacts.attributes || EXCLUDED.attributes,
            consent_at = COALESCE(contacts.consent_at, EXCLUDED.consent_at),
            consent_source = COALESCE(contacts.consent_source, EXCLUDED.consent_source),
            updated_at = now()`
        : Prisma.sql`DO NOTHING`;

    const affected = await this.prisma.$queryRaw<Array<{ inserted: boolean }>>`
      INSERT INTO contacts (id, tenant_id, email, email_normalized, first_name, last_name, company, locale,
                            timezone, external_id, attributes, source, consent_at, consent_source, updated_at)
      SELECT uuidv7(), ${tenantId}::uuid, t.email, t.email_normalized, t.first_name, t.last_name, t.company,
             t.locale, t.timezone, t.external_id, t.attributes::jsonb, t.source, t.consent_at::timestamp(3),
             t.consent_source, now()
      FROM unnest(
        ${column((row) => row.email)}::text[],
        ${column((row) => row.emailNormalized)}::text[],
        ${column((row) => row.firstName ?? null)}::text[],
        ${column((row) => row.lastName ?? null)}::text[],
        ${column((row) => row.company ?? null)}::text[],
        ${column((row) => row.locale ?? null)}::text[],
        ${column((row) => row.timezone ?? null)}::text[],
        ${column((row) => row.externalId ?? null)}::text[],
        ${column((row) => JSON.stringify(row.attributes))}::text[],
        ${column((row) => row.source ?? 'import')}::text[],
        ${column((row) => (row.consentAt ? row.consentAt.toISOString() : null))}::text[],
        ${column((row) => row.consentSource ?? null)}::text[]
      ) AS t(email, email_normalized, first_name, last_name, company, locale, timezone, external_id,
             attributes, source, consent_at, consent_source)
      ON CONFLICT (tenant_id, email_normalized) ${conflict}
      RETURNING (xmax = 0) AS inserted`;

    const created = affected.filter((row) => row.inserted).length;
    const updated = affected.length - created;
    const idRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM contacts
      WHERE tenant_id = ${tenantId}::uuid AND email_normalized = ANY(${column((row) => row.emailNormalized)}::text[])`;
    return {
      created,
      updated,
      skipped: rows.length - affected.length,
      contactIds: idRows.map((row) => row.id),
    };
  }

  async count(context: TenantContext, segment: ResolvedSegmentFilter): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ total: number }>>`
      SELECT count(*)::int AS total FROM contacts c
      WHERE c.tenant_id = ${context.tenantId}::uuid AND ${compileSegmentRules(segment.rules, segment.catalog, segment.now)}`;
    return rows[0]?.total ?? 0;
  }

  /**
   * Un `external_id` ya asignado a otro contacto rompería todo el lote por la restricción única.
   * Se descarta ese valor (se conserva el del contacto existente) y también los repetidos en el lote.
   */
  private async dropConflictingExternalIds(
    tenantId: string,
    rows: ContactWriteData[],
  ): Promise<ContactWriteData[]> {
    const externalIds = [
      ...new Set(rows.map((row) => row.externalId).filter((id): id is string => Boolean(id))),
    ];
    if (externalIds.length === 0) return rows;
    const owners = await this.prisma.$queryRaw<
      Array<{ external_id: string; email_normalized: string }>
    >`
      SELECT external_id, email_normalized FROM contacts
      WHERE tenant_id = ${tenantId}::uuid AND external_id = ANY(${externalIds}::text[])`;
    const ownerByExternalId = new Map(
      owners.map((owner) => [owner.external_id, owner.email_normalized]),
    );
    const seen = new Set<string>();
    return rows.map((row) => {
      if (!row.externalId) return row;
      const owner = ownerByExternalId.get(row.externalId);
      const conflict =
        (owner !== undefined && owner !== row.emailNormalized) || seen.has(row.externalId);
      seen.add(row.externalId);
      return conflict ? { ...row, externalId: null } : row;
    });
  }

  private async mapConflicts<T>(
    context: TenantContext,
    data: ContactWriteData,
    operation: () => Promise<T>,
    ownContactId?: string,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const sameEmail = await this.clients.forTenant(context.tenantId).contact.findFirst({
        where: {
          emailNormalized: data.emailNormalized,
          ...(ownContactId ? { id: { not: ownContactId } } : {}),
        },
        select: { id: true },
      });
      const field = sameEmail ? 'email' : 'externalId';
      throw new DomainError('CONFLICT', `Ya existe un contacto con ese ${field}`, { field });
    }
  }

  private async requireDetail(context: TenantContext, contactId: string): Promise<ContactDetail> {
    const detail = await this.findById(context, contactId);
    if (!detail) throw new DomainError('NOT_FOUND', 'Contacto inexistente');
    return detail;
  }
}
