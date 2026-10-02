/** Casos de uso de listas, etiquetas, segmentos, campos personalizados y temas. */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  createContactFieldSchema,
  contactFieldKeySchema,
  type CreateContactFieldInput,
} from '../contact-fields';
import type {
  ContactFieldRepository,
  ContactListRepository,
  ContactRepository,
  SegmentRepository,
  TagRepository,
  TopicRepository,
} from '../ports';
import {
  buildSegmentCatalog,
  segmentRuleSetSchema,
  validateSegmentRules,
  type SegmentRuleSet,
} from '../segments';

const optionalDescription = z
  .string()
  .trim()
  .max(300)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null);

// ----------------------------------------------------------------------------
// Listas
// ----------------------------------------------------------------------------

export const contactListSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalDescription,
});

export const listMembershipSchema = z.object({
  listId: z.uuid(),
  contactIds: z.array(z.uuid()).min(1).max(1000),
});

export class ManageContactListsUseCase {
  constructor(
    private readonly lists: ContactListRepository,
    private readonly audit: AuditLogger,
  ) {}

  list(context: TenantContext) {
    assertCan(context, 'contact:read');
    return this.lists.list(context);
  }

  async get(context: TenantContext, listId: string) {
    assertCan(context, 'contact:read');
    const list = await this.lists.findById(context, listId);
    if (!list) throw new DomainError('NOT_FOUND', 'Lista inexistente');
    return list;
  }

  async create(context: TenantContext, input: z.infer<typeof contactListSchema>) {
    assertCan(context, 'list:write');
    const list = await this.lists.create(context, input);
    await this.audit.record(context, {
      action: 'list.created',
      entityType: 'list',
      entityId: list.id,
    });
    return list;
  }

  async update(context: TenantContext, listId: string, input: z.infer<typeof contactListSchema>) {
    assertCan(context, 'list:write');
    await this.get(context, listId);
    const list = await this.lists.update(context, listId, input);
    await this.audit.record(context, {
      action: 'list.updated',
      entityType: 'list',
      entityId: listId,
    });
    return list;
  }

  async delete(context: TenantContext, listId: string) {
    assertCan(context, 'list:write');
    if (!(await this.lists.delete(context, listId)))
      throw new DomainError('NOT_FOUND', 'Lista inexistente');
    await this.audit.record(context, {
      action: 'list.deleted',
      entityType: 'list',
      entityId: listId,
    });
  }

  async addContacts(context: TenantContext, input: z.infer<typeof listMembershipSchema>) {
    assertCan(context, 'list:write');
    await this.get(context, input.listId);
    const added = await this.lists.addContacts(context, input.listId, input.contactIds, 'manual');
    await this.audit.record(context, {
      action: 'list.contacts_added',
      entityType: 'list',
      entityId: input.listId,
      metadata: { count: added },
    });
    return added;
  }

  async removeContacts(context: TenantContext, input: z.infer<typeof listMembershipSchema>) {
    assertCan(context, 'list:write');
    await this.get(context, input.listId);
    const removed = await this.lists.removeContacts(context, input.listId, input.contactIds);
    await this.audit.record(context, {
      action: 'list.contacts_removed',
      entityType: 'list',
      entityId: input.listId,
      metadata: { count: removed },
    });
    return removed;
  }
}

// ----------------------------------------------------------------------------
// Etiquetas
// ----------------------------------------------------------------------------

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
});

export class ManageTagsUseCase {
  constructor(
    private readonly tags: TagRepository,
    private readonly audit: AuditLogger,
  ) {}

  list(context: TenantContext) {
    assertCan(context, 'contact:read');
    return this.tags.list(context);
  }

  async create(context: TenantContext, input: z.infer<typeof tagSchema>) {
    assertCan(context, 'contact:write');
    const tag = await this.tags.create(context, input);
    await this.audit.record(context, {
      action: 'tag.created',
      entityType: 'tag',
      entityId: tag.id,
    });
    return tag;
  }

  async delete(context: TenantContext, tagId: string) {
    assertCan(context, 'contact:write');
    if (!(await this.tags.delete(context, tagId)))
      throw new DomainError('NOT_FOUND', 'Etiqueta inexistente');
    await this.audit.record(context, { action: 'tag.deleted', entityType: 'tag', entityId: tagId });
  }
}

// ----------------------------------------------------------------------------
// Segmentos
// ----------------------------------------------------------------------------

export const segmentInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalDescription,
  rules: segmentRuleSetSchema,
});

export class ManageSegmentsUseCase {
  constructor(
    private readonly segments: SegmentRepository,
    private readonly contacts: ContactRepository,
    private readonly fields: ContactFieldRepository,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  list(context: TenantContext) {
    assertCan(context, 'contact:read');
    return this.segments.list(context);
  }

  async get(context: TenantContext, segmentId: string) {
    assertCan(context, 'contact:read');
    const segment = await this.segments.findById(context, segmentId);
    if (!segment) throw new DomainError('NOT_FOUND', 'Segmento inexistente');
    return segment;
  }

  /** Valida las reglas y cuenta los contactos que cumplen el segmento (vista previa). */
  async previewCount(context: TenantContext, rules: SegmentRuleSet): Promise<number> {
    assertCan(context, 'contact:read');
    const catalog = buildSegmentCatalog(await this.fields.list(context));
    validateSegmentRules(rules, catalog);
    return this.contacts.count(context, { rules, catalog, now: this.clock.now() });
  }

  async create(context: TenantContext, input: z.infer<typeof segmentInputSchema>) {
    assertCan(context, 'segment:write');
    const count = await this.previewCount(context, input.rules);
    const segment = await this.segments.create(context, input);
    await this.segments.saveCount(context, segment.id, count, this.clock.now());
    await this.audit.record(context, {
      action: 'segment.created',
      entityType: 'segment',
      entityId: segment.id,
    });
    return { ...segment, lastCount: count };
  }

  async update(
    context: TenantContext,
    segmentId: string,
    input: z.infer<typeof segmentInputSchema>,
  ) {
    assertCan(context, 'segment:write');
    await this.get(context, segmentId);
    const count = await this.previewCount(context, input.rules);
    const segment = await this.segments.update(context, segmentId, input);
    await this.segments.saveCount(context, segmentId, count, this.clock.now());
    await this.audit.record(context, {
      action: 'segment.updated',
      entityType: 'segment',
      entityId: segmentId,
    });
    return { ...segment, lastCount: count };
  }

  async delete(context: TenantContext, segmentId: string) {
    assertCan(context, 'segment:write');
    if (!(await this.segments.delete(context, segmentId))) {
      throw new DomainError('NOT_FOUND', 'Segmento inexistente');
    }
    await this.audit.record(context, {
      action: 'segment.deleted',
      entityType: 'segment',
      entityId: segmentId,
    });
  }
}

// ----------------------------------------------------------------------------
// Campos personalizados y temas
// ----------------------------------------------------------------------------

export class ManageContactFieldsUseCase {
  constructor(
    private readonly fields: ContactFieldRepository,
    private readonly audit: AuditLogger,
  ) {}

  list(context: TenantContext) {
    assertCan(context, 'contact:read');
    return this.fields.list(context);
  }

  async create(context: TenantContext, input: CreateContactFieldInput) {
    assertCan(context, 'field:manage');
    const field = await this.fields.create(context, createContactFieldSchema.parse(input));
    await this.audit.record(context, {
      action: 'field.created',
      entityType: 'contact_field',
      entityId: field.id,
      metadata: { key: field.key, type: field.type },
    });
    return field;
  }

  /** Los valores ya guardados en `attributes` se conservan; dejan de mostrarse y filtrarse. */
  async delete(context: TenantContext, fieldId: string) {
    assertCan(context, 'field:manage');
    if (!(await this.fields.delete(context, fieldId)))
      throw new DomainError('NOT_FOUND', 'Campo inexistente');
    await this.audit.record(context, {
      action: 'field.deleted',
      entityType: 'contact_field',
      entityId: fieldId,
    });
  }
}

const localizedNameSchema = z.object({
  es: z.string().trim().min(1).max(80),
  en: z.string().trim().min(1).max(80),
});

export const topicSchema = z.object({
  key: contactFieldKeySchema,
  name: localizedNameSchema,
  description: z
    .object({
      es: z.string().trim().max(300).optional(),
      en: z.string().trim().max(300).optional(),
    })
    .default({}),
  isDefault: z.boolean().default(true),
});

export class ManageTopicsUseCase {
  constructor(
    private readonly topics: TopicRepository,
    private readonly audit: AuditLogger,
  ) {}

  list(context: TenantContext) {
    assertCan(context, 'contact:read');
    return this.topics.list(context);
  }

  async create(context: TenantContext, input: z.infer<typeof topicSchema>) {
    assertCan(context, 'topic:manage');
    const topic = await this.topics.create(context, input);
    await this.audit.record(context, {
      action: 'topic.created',
      entityType: 'topic',
      entityId: topic.id,
    });
    return topic;
  }

  async update(
    context: TenantContext,
    topicId: string,
    input: Omit<z.infer<typeof topicSchema>, 'key'>,
  ) {
    assertCan(context, 'topic:manage');
    const topic = await this.topics.update(context, topicId, input);
    await this.audit.record(context, {
      action: 'topic.updated',
      entityType: 'topic',
      entityId: topicId,
    });
    return topic;
  }

  async delete(context: TenantContext, topicId: string) {
    assertCan(context, 'topic:manage');
    if (!(await this.topics.delete(context, topicId)))
      throw new DomainError('NOT_FOUND', 'Tema inexistente');
    await this.audit.record(context, {
      action: 'topic.deleted',
      entityType: 'topic',
      entityId: topicId,
    });
  }
}
