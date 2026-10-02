/** Repositorios de listas, etiquetas, segmentos, campos personalizados, temas e importaciones. */
import { z } from 'zod';
import {
  FIELD_TYPES,
  type ContactFieldDefinition,
  type CreateContactFieldInput,
} from '@/core/contacts/contact-fields';
import type {
  ContactFieldRepository,
  ContactImportPatch,
  ContactImportRecord,
  ContactImportRepository,
  ContactListRepository,
  ContactListView,
  SegmentRepository,
  SegmentView,
  TagRepository,
  TagView,
  TopicRepository,
  TopicView,
} from '@/core/contacts/ports';
import { segmentRuleSetSchema, type SegmentRuleSet } from '@/core/contacts/segments';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { Prisma } from '../generated/client';
import { withDomainErrors } from '../prisma-errors';
import type { TenantClientCache } from '../tenant-scope.extension';

const asJson = (value: unknown) => value as Prisma.InputJsonValue;

// ----------------------------------------------------------------------------
// Listas
// ----------------------------------------------------------------------------

const LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  _count: { select: { memberships: true } },
} as const;

function toListView(row: {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  _count: { memberships: number };
}): ContactListView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    memberCount: row._count.memberships,
  };
}

export class PrismaContactListRepository implements ContactListRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async list(context: TenantContext): Promise<ContactListView[]> {
    const rows = await this.clients
      .forTenant(context.tenantId)
      .contactList.findMany({ select: LIST_SELECT, orderBy: { name: 'asc' } });
    return rows.map(toListView);
  }

  async findById(context: TenantContext, listId: string): Promise<ContactListView | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .contactList.findFirst({ where: { id: listId }, select: LIST_SELECT });
    return row ? toListView(row) : null;
  }

  async create(context: TenantContext, input: { name: string; description: string | null }) {
    const row = await withDomainErrors(
      () =>
        this.clients.forTenant(context.tenantId).contactList.create({
          data: { ...input, tenantId: context.tenantId },
          select: LIST_SELECT,
        }),
      'name',
    );
    return toListView(row);
  }

  async update(
    context: TenantContext,
    listId: string,
    input: { name: string; description: string | null },
  ) {
    const row = await withDomainErrors(
      () =>
        this.clients
          .forTenant(context.tenantId)
          .contactList.update({ where: { id: listId }, data: input, select: LIST_SELECT }),
      'name',
    );
    return toListView(row);
  }

  async delete(context: TenantContext, listId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .contactList.deleteMany({ where: { id: listId } });
    return count > 0;
  }

  countExisting(context: TenantContext, listIds: readonly string[]): Promise<number> {
    return this.clients
      .forTenant(context.tenantId)
      .contactList.count({ where: { id: { in: [...listIds] } } });
  }

  async addContacts(
    context: TenantContext,
    listId: string,
    contactIds: readonly string[],
    source: string,
  ) {
    const scoped = this.clients.forTenant(context.tenantId);
    // Solo contactos del propio tenant (protección IDOR en la tabla intermedia).
    const owned = await scoped.contact.findMany({
      where: { id: { in: [...contactIds] } },
      select: { id: true },
    });
    const { count } = await scoped.listMembership.createMany({
      data: owned.map((contact) => ({
        tenantId: context.tenantId,
        listId,
        contactId: contact.id,
        source,
      })),
      skipDuplicates: true,
    });
    return count;
  }

  async removeContacts(context: TenantContext, listId: string, contactIds: readonly string[]) {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .listMembership.deleteMany({ where: { listId, contactId: { in: [...contactIds] } } });
    return count;
  }
}

// ----------------------------------------------------------------------------
// Etiquetas
// ----------------------------------------------------------------------------

export class PrismaTagRepository implements TagRepository {
  constructor(private readonly clients: TenantClientCache) {}

  list(context: TenantContext): Promise<TagView[]> {
    return this.clients
      .forTenant(context.tenantId)
      .tag.findMany({ select: { id: true, name: true, color: true }, orderBy: { name: 'asc' } });
  }

  create(context: TenantContext, input: { name: string; color: string | null }): Promise<TagView> {
    return withDomainErrors(
      () =>
        this.clients.forTenant(context.tenantId).tag.create({
          data: { ...input, tenantId: context.tenantId },
          select: { id: true, name: true, color: true },
        }),
      'name',
    );
  }

  async delete(context: TenantContext, tagId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .tag.deleteMany({ where: { id: tagId } });
    return count > 0;
  }

  countExisting(context: TenantContext, tagIds: readonly string[]): Promise<number> {
    return this.clients
      .forTenant(context.tenantId)
      .tag.count({ where: { id: { in: [...tagIds] } } });
  }
}

// ----------------------------------------------------------------------------
// Segmentos
// ----------------------------------------------------------------------------

const SEGMENT_SELECT = {
  id: true,
  name: true,
  description: true,
  rules: true,
  lastCount: true,
  lastCountedAt: true,
  updatedAt: true,
} as const;

function toSegmentView(row: {
  id: string;
  name: string;
  description: string | null;
  rules: unknown;
  lastCount: number | null;
  lastCountedAt: Date | null;
  updatedAt: Date;
}): SegmentView {
  return { ...row, rules: segmentRuleSetSchema.parse(row.rules) };
}

type SegmentInput = { name: string; description: string | null; rules: SegmentRuleSet };

export class PrismaSegmentRepository implements SegmentRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async list(context: TenantContext): Promise<SegmentView[]> {
    const rows = await this.clients
      .forTenant(context.tenantId)
      .segment.findMany({ select: SEGMENT_SELECT, orderBy: { name: 'asc' } });
    return rows.map(toSegmentView);
  }

  async findById(context: TenantContext, segmentId: string): Promise<SegmentView | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .segment.findFirst({ where: { id: segmentId }, select: SEGMENT_SELECT });
    return row ? toSegmentView(row) : null;
  }

  async create(context: TenantContext, input: SegmentInput): Promise<SegmentView> {
    const row = await withDomainErrors(
      () =>
        this.clients.forTenant(context.tenantId).segment.create({
          data: { ...input, rules: asJson(input.rules), tenantId: context.tenantId },
          select: SEGMENT_SELECT,
        }),
      'name',
    );
    return toSegmentView(row);
  }

  async update(
    context: TenantContext,
    segmentId: string,
    input: SegmentInput,
  ): Promise<SegmentView> {
    const row = await withDomainErrors(
      () =>
        this.clients.forTenant(context.tenantId).segment.update({
          where: { id: segmentId },
          data: { ...input, rules: asJson(input.rules) },
          select: SEGMENT_SELECT,
        }),
      'name',
    );
    return toSegmentView(row);
  }

  async delete(context: TenantContext, segmentId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .segment.deleteMany({ where: { id: segmentId } });
    return count > 0;
  }

  async saveCount(
    context: TenantContext,
    segmentId: string,
    count: number,
    at: Date,
  ): Promise<void> {
    await this.clients.forTenant(context.tenantId).segment.updateMany({
      where: { id: segmentId },
      data: { lastCount: count, lastCountedAt: at },
    });
  }
}

// ----------------------------------------------------------------------------
// Campos personalizados
// ----------------------------------------------------------------------------

const fieldRowSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string()).catch([]),
});

export class PrismaContactFieldRepository implements ContactFieldRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async list(context: TenantContext): Promise<ContactFieldDefinition[]> {
    const rows = await this.clients
      .forTenant(context.tenantId)
      .contactField.findMany({ orderBy: { label: 'asc' } });
    return rows.map((row) => fieldRowSchema.parse(row));
  }

  async create(
    context: TenantContext,
    input: CreateContactFieldInput,
  ): Promise<ContactFieldDefinition> {
    const row = await withDomainErrors(
      () =>
        this.clients.forTenant(context.tenantId).contactField.create({
          data: { ...input, options: asJson(input.options), tenantId: context.tenantId },
        }),
      'key',
    );
    return fieldRowSchema.parse(row);
  }

  async delete(context: TenantContext, fieldId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .contactField.deleteMany({ where: { id: fieldId } });
    return count > 0;
  }
}

// ----------------------------------------------------------------------------
// Temas de suscripción
// ----------------------------------------------------------------------------

const topicRowSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.object({ es: z.string(), en: z.string() }),
  description: z.object({ es: z.string().optional(), en: z.string().optional() }).catch({}),
  isDefault: z.boolean(),
});

export class PrismaTopicRepository implements TopicRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async list(context: TenantContext): Promise<TopicView[]> {
    const rows = await this.clients
      .forTenant(context.tenantId)
      .topic.findMany({ orderBy: { key: 'asc' } });
    return rows.map((row) => topicRowSchema.parse(row));
  }

  async create(context: TenantContext, input: Omit<TopicView, 'id'>): Promise<TopicView> {
    const row = await withDomainErrors(
      () =>
        this.clients.forTenant(context.tenantId).topic.create({
          data: {
            key: input.key,
            name: asJson(input.name),
            description: asJson(input.description),
            isDefault: input.isDefault,
            tenantId: context.tenantId,
          },
        }),
      'key',
    );
    return topicRowSchema.parse(row);
  }

  async update(
    context: TenantContext,
    topicId: string,
    input: Omit<TopicView, 'id' | 'key'>,
  ): Promise<TopicView> {
    const row = await withDomainErrors(
      () =>
        this.clients.forTenant(context.tenantId).topic.update({
          where: { id: topicId },
          data: {
            name: asJson(input.name),
            description: asJson(input.description),
            isDefault: input.isDefault,
          },
        }),
      'key',
    );
    return topicRowSchema.parse(row);
  }

  async delete(context: TenantContext, topicId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .topic.deleteMany({ where: { id: topicId } });
    return count > 0;
  }

  countExisting(context: TenantContext, topicIds: readonly string[]): Promise<number> {
    return this.clients
      .forTenant(context.tenantId)
      .topic.count({ where: { id: { in: [...topicIds] } } });
  }
}

// ----------------------------------------------------------------------------
// Importaciones
// ----------------------------------------------------------------------------

const importRowSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileType: z.enum(['csv', 'xlsx']),
  storageKey: z.string(),
  status: z.enum(['UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']),
  headers: z.array(z.string()).catch([]),
  previewRows: z.array(z.array(z.string())).catch([]),
  mapping: z.record(z.string(), z.string()).nullable().catch(null),
  duplicatePolicy: z.enum(['UPDATE', 'SKIP']),
  listId: z.string().nullable(),
  consentSource: z.string().nullable(),
  totalRows: z.number(),
  createdCount: z.number(),
  updatedCount: z.number(),
  skippedCount: z.number(),
  invalidCount: z.number(),
  errorReportKey: z.string().nullable(),
  error: z.string().nullable(),
  createdById: z.string(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  createdAt: z.date(),
});

function toImportRecord(row: unknown): ContactImportRecord {
  return importRowSchema.parse(row);
}

export class PrismaContactImportRepository implements ContactImportRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async create(
    context: TenantContext,
    input: Pick<
      ContactImportRecord,
      'fileName' | 'fileType' | 'storageKey' | 'headers' | 'previewRows' | 'createdById'
    >,
  ): Promise<ContactImportRecord> {
    const row = await this.clients.forTenant(context.tenantId).contactImport.create({
      data: {
        ...input,
        headers: asJson(input.headers),
        previewRows: asJson(input.previewRows),
        tenantId: context.tenantId,
      },
    });
    return toImportRecord(row);
  }

  async findById(context: TenantContext, importId: string): Promise<ContactImportRecord | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .contactImport.findFirst({ where: { id: importId } });
    return row ? toImportRecord(row) : null;
  }

  async listRecent(context: TenantContext, limit: number): Promise<ContactImportRecord[]> {
    const rows = await this.clients
      .forTenant(context.tenantId)
      .contactImport.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(toImportRecord);
  }

  async update(context: TenantContext, importId: string, patch: ContactImportPatch): Promise<void> {
    const { mapping, ...rest } = patch;
    await this.clients.forTenant(context.tenantId).contactImport.updateMany({
      where: { id: importId },
      data: { ...rest, ...(mapping !== undefined ? { mapping: asJson(mapping) } : {}) },
    });
  }
}
