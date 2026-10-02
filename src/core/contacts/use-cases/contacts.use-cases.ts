/** Casos de uso de contactos: consulta, alta, edición y borrado (derecho al olvido). */
import type { AuditLogger } from '@/core/audit/audit-log';
import { normalizeEmail } from '@/core/identity/email';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Page } from '@/core/shared/pagination';
import type { Clock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type {
  ContactDetail,
  ContactInput,
  ContactQuery,
  ContactSource,
  ContactSummary,
  ContactWriteData,
} from '../contact';
import { normalizeAttributes } from '../contact-fields';
import type {
  ContactFieldRepository,
  ContactListRepository,
  ContactRelations,
  ContactRepository,
  SegmentRepository,
  TagRepository,
  TopicRepository,
} from '../ports';
import { buildSegmentCatalog } from '../segments';

export interface ContactUseCaseDeps {
  contacts: ContactRepository;
  fields: ContactFieldRepository;
  lists: ContactListRepository;
  tags: TagRepository;
  topics: TopicRepository;
  segments: SegmentRepository;
  audit: AuditLogger;
  clock: Clock;
}

async function assertAllExist(
  ids: readonly string[] | undefined,
  count: (ids: readonly string[]) => Promise<number>,
  field: string,
): Promise<void> {
  if (!ids || ids.length === 0) return;
  const unique = [...new Set(ids)];
  if ((await count(unique)) !== unique.length) {
    // Un id de otro tenant se trata igual que uno inexistente (sin filtrar información).
    throw new DomainError('VALIDATION', `Referencias inválidas en ${field}`, { field });
  }
}

/** Normaliza y valida la entrada; también comprueba que listas, etiquetas y temas son del tenant. */
async function prepareWrite(
  deps: ContactUseCaseDeps,
  context: TenantContext,
  input: ContactInput,
  source: ContactSource,
): Promise<{ data: ContactWriteData; relations: ContactRelations }> {
  const fields = await deps.fields.list(context);
  const { attributes, errors } = normalizeAttributes(fields, input.attributes);
  if (errors.length > 0) {
    throw new DomainError('VALIDATION', 'Atributos inválidos', { attributes: errors });
  }
  const topicIds = input.topicSubscriptions ? Object.keys(input.topicSubscriptions) : undefined;
  await Promise.all([
    assertAllExist(input.listIds, (ids) => deps.lists.countExisting(context, ids), 'listIds'),
    assertAllExist(input.tagIds, (ids) => deps.tags.countExisting(context, ids), 'tagIds'),
    assertAllExist(
      topicIds,
      (ids) => deps.topics.countExisting(context, ids),
      'topicSubscriptions',
    ),
  ]);
  return {
    data: {
      email: input.email.trim(),
      emailNormalized: normalizeEmail(input.email),
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
      locale: input.locale,
      timezone: input.timezone,
      externalId: input.externalId,
      status: input.status,
      attributes,
      source,
    },
    relations: {
      listIds: input.listIds,
      tagIds: input.tagIds,
      topicSubscriptions: input.topicSubscriptions,
    },
  };
}

export class ListContactsUseCase {
  constructor(private readonly deps: ContactUseCaseDeps) {}

  async execute(context: TenantContext, query: ContactQuery): Promise<Page<ContactSummary>> {
    assertCan(context, 'contact:read');
    const { segmentId, ...rest } = query;
    if (!segmentId) return this.deps.contacts.list(context, rest);

    const segment = await this.deps.segments.findById(context, segmentId);
    if (!segment) throw new DomainError('NOT_FOUND', 'Segmento inexistente');
    const catalog = buildSegmentCatalog(await this.deps.fields.list(context));
    return this.deps.contacts.list(context, rest, {
      rules: segment.rules,
      catalog,
      now: this.deps.clock.now(),
    });
  }
}

export class GetContactUseCase {
  constructor(private readonly contacts: ContactRepository) {}

  async execute(context: TenantContext, contactId: string): Promise<ContactDetail> {
    assertCan(context, 'contact:read');
    const contact = await this.contacts.findById(context, contactId);
    if (!contact) throw new DomainError('NOT_FOUND', 'Contacto inexistente');
    return contact;
  }
}

export class CreateContactUseCase {
  constructor(private readonly deps: ContactUseCaseDeps) {}

  async execute(
    context: TenantContext,
    input: ContactInput,
    source: ContactSource = 'manual',
  ): Promise<ContactDetail> {
    assertCan(context, 'contact:write');
    const { data, relations } = await prepareWrite(this.deps, context, input, source);
    const contact = await this.deps.contacts.create(context, data, relations);
    await this.deps.audit.record(context, {
      action: 'contact.created',
      entityType: 'contact',
      entityId: contact.id,
      metadata: { source },
    });
    return contact;
  }
}

export class UpdateContactUseCase {
  constructor(private readonly deps: ContactUseCaseDeps) {}

  async execute(
    context: TenantContext,
    contactId: string,
    input: ContactInput,
  ): Promise<ContactDetail> {
    assertCan(context, 'contact:write');
    if (!(await this.deps.contacts.findById(context, contactId))) {
      throw new DomainError('NOT_FOUND', 'Contacto inexistente');
    }
    const { data, relations } = await prepareWrite(this.deps, context, input, 'manual');
    const { source: _source, ...withoutSource } = data;
    const contact = await this.deps.contacts.update(context, contactId, withoutSource, relations);
    await this.deps.audit.record(context, {
      action: 'contact.updated',
      entityType: 'contact',
      entityId: contactId,
    });
    return contact;
  }
}

export class DeleteContactUseCase {
  constructor(
    private readonly contacts: ContactRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(context: TenantContext, contactId: string): Promise<void> {
    assertCan(context, 'contact:delete');
    if (!(await this.contacts.delete(context, contactId))) {
      throw new DomainError('NOT_FOUND', 'Contacto inexistente');
    }
    // Sin datos personales en la auditoría: solo el identificador.
    await this.audit.record(context, {
      action: 'contact.deleted',
      entityType: 'contact',
      entityId: contactId,
    });
  }
}

/**
 * Alta o actualización por email (integraciones vía API). Las listas se añaden sin quitar
 * las existentes y el estado de suscripción no se modifica desde la API.
 */
export class UpsertContactUseCase {
  constructor(private readonly deps: ContactUseCaseDeps) {}

  async execute(
    context: TenantContext,
    input: ContactInput,
  ): Promise<{ contact: ContactDetail; created: boolean }> {
    assertCan(context, 'contact:write');
    const { data, relations } = await prepareWrite(
      this.deps,
      context,
      { ...input, status: undefined },
      'api',
    );
    const existingId = await this.deps.contacts.findIdByEmail(context, data.emailNormalized);
    if (!existingId) {
      const contact = await this.deps.contacts.create(context, data, relations);
      await this.deps.audit.record(context, {
        action: 'contact.created',
        entityType: 'contact',
        entityId: contact.id,
        metadata: { source: 'api' },
      });
      return { contact, created: true };
    }

    const current = await this.deps.contacts.findById(context, existingId);
    if (!current) throw new DomainError('NOT_FOUND', 'Contacto inexistente');
    // Un campo ausente en la petición conserva su valor actual.
    const keep = <
      K extends 'firstName' | 'lastName' | 'company' | 'locale' | 'timezone' | 'externalId',
    >(
      key: K,
    ) => (input[key] === undefined ? current[key] : data[key]);
    const contact = await this.deps.contacts.update(
      context,
      existingId,
      {
        email: data.email,
        emailNormalized: data.emailNormalized,
        firstName: keep('firstName'),
        lastName: keep('lastName'),
        company: keep('company'),
        locale: keep('locale'),
        timezone: keep('timezone'),
        externalId: keep('externalId'),
        attributes: { ...current.attributes, ...data.attributes },
      },
      {
        listIds: relations.listIds
          ? [...new Set([...current.listIds, ...relations.listIds])]
          : undefined,
        tagIds: relations.tagIds
          ? [...new Set([...current.tagIds, ...relations.tagIds])]
          : undefined,
        topicSubscriptions: relations.topicSubscriptions,
      },
    );
    await this.deps.audit.record(context, {
      action: 'contact.updated',
      entityType: 'contact',
      entityId: existingId,
      metadata: { source: 'api' },
    });
    return { contact, created: false };
  }
}
