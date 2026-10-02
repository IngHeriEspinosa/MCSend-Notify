/**
 * Casos de uso de plantillas: listado, creación, guardado con versiones, restauración,
 * duplicado, eliminación y vista previa con un contacto real o de ejemplo.
 *
 * Cada guardado crea una versión inmutable; el guardado usa concurrencia optimista para que
 * dos personas editando a la vez no se pisen los cambios sin saberlo.
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import type { ContactFieldRepository, ContactRepository } from '@/core/contacts/ports';
import type { DocumentRepository, PublicAssetLinks } from '@/core/documents/ports';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import type { BrandingRepository } from '@/core/tenants/branding';
import { referencedDocumentIds, templateBodySchema, type TemplateBody } from '../email-content';
import type {
  DocumentAsset,
  EmailCompiler,
  EmailSender,
  TemplateRecord,
  TemplateRepository,
} from '../ports';
import {
  buildRecipientVariables,
  SAMPLE_RECIPIENT,
  type RecipientData,
} from '../template-variables';

const templateMetaFields = {
  name: z.string().trim().min(2).max(120),
  description: z
    .string()
    .trim()
    .max(300)
    .transform((value) => (value === '' ? null : value))
    .nullable(),
};

export const createTemplateSchema = z.object({ ...templateMetaFields, body: templateBodySchema });

export const saveTemplateSchema = z.object({
  ...templateMetaFields,
  templateId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  note: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === '' ? null : value))
    .nullable(),
  body: templateBodySchema,
});

export const previewTemplateSchema = z.object({
  body: templateBodySchema,
  contactId: z.uuid().nullable(),
  colorScheme: z.enum(['light', 'dark']).default('light'),
});

/** En la vista previa los enlaces de baja no deben ejecutar nada: apuntan a un ancla inocua. */
const PREVIEW_LINKS = { unsubscribeUrl: '#unsubscribe', preferencesUrl: '#preferences' };

export interface TemplateUseCaseDeps {
  templates: TemplateRepository;
  documents: DocumentRepository;
  contacts: ContactRepository;
  fields: ContactFieldRepository;
  branding: BrandingRepository;
  assets: PublicAssetLinks;
  compiler: EmailCompiler;
  audit: AuditLogger;
  clock: Clock;
}

function requireUserId(context: TenantContext): string {
  const userId = actorUserId(context);
  if (!userId) throw new DomainError('FORBIDDEN', 'Solo un usuario edita plantillas');
  return userId;
}

export class ManageTemplatesUseCase {
  constructor(private readonly deps: TemplateUseCaseDeps) {}

  list(context: TenantContext) {
    assertCan(context, 'template:read');
    return this.deps.templates.list(context);
  }

  async get(context: TenantContext, templateId: string): Promise<TemplateRecord> {
    assertCan(context, 'template:read');
    const template = await this.deps.templates.findById(context, templateId);
    if (!template) throw new DomainError('NOT_FOUND', 'Plantilla inexistente');
    return template;
  }

  async versions(context: TenantContext, templateId: string) {
    await this.get(context, templateId);
    return this.deps.templates.listVersions(context, templateId);
  }

  async create(context: TenantContext, input: z.infer<typeof createTemplateSchema>) {
    assertCan(context, 'template:write');
    const template = await this.deps.templates.create(context, {
      name: input.name,
      description: input.description,
      body: input.body,
      note: null,
      userId: requireUserId(context),
    });
    await this.deps.audit.record(context, {
      action: 'template.created',
      entityType: 'template',
      entityId: template.id,
      metadata: { format: template.format },
    });
    return template;
  }

  async save(context: TenantContext, input: z.infer<typeof saveTemplateSchema>) {
    assertCan(context, 'template:write');
    await this.get(context, input.templateId);
    const saved = await this.deps.templates.saveVersion(
      context,
      input.templateId,
      input.expectedVersion,
      {
        name: input.name,
        description: input.description,
        body: input.body,
        note: input.note,
        userId: requireUserId(context),
      },
    );
    if (!saved) {
      throw new DomainError('CONFLICT', 'La plantilla cambió mientras se editaba', {
        reason: 'STALE_VERSION',
      });
    }
    await this.deps.audit.record(context, {
      action: 'template.saved',
      entityType: 'template',
      entityId: saved.id,
      metadata: { version: saved.currentVersion },
    });
    return saved;
  }

  /** Restaurar crea una versión nueva con el contenido antiguo: el historial nunca se reescribe. */
  async restore(context: TenantContext, templateId: string, version: number) {
    assertCan(context, 'template:write');
    const template = await this.get(context, templateId);
    const old = await this.deps.templates.findVersion(context, templateId, version);
    if (!old) throw new DomainError('NOT_FOUND', 'Versión inexistente');
    const saved = await this.deps.templates.saveVersion(
      context,
      templateId,
      template.currentVersion,
      {
        name: template.name,
        description: template.description,
        body: old.body,
        note: `restore:${version}`,
        userId: requireUserId(context),
      },
    );
    if (!saved) {
      throw new DomainError('CONFLICT', 'La plantilla cambió durante la restauración', {
        reason: 'STALE_VERSION',
      });
    }
    await this.deps.audit.record(context, {
      action: 'template.restored',
      entityType: 'template',
      entityId: templateId,
      metadata: { fromVersion: version, version: saved.currentVersion },
    });
    return saved;
  }

  async duplicate(context: TenantContext, templateId: string, name: string) {
    assertCan(context, 'template:write');
    const template = await this.get(context, templateId);
    return this.create(context, { name, description: template.description, body: template.body });
  }

  async delete(context: TenantContext, templateId: string) {
    assertCan(context, 'template:write');
    const deleted = await this.deps.templates.delete(context, templateId);
    if (!deleted) throw new DomainError('NOT_FOUND', 'Plantilla inexistente');
    await this.deps.audit.record(context, {
      action: 'template.deleted',
      entityType: 'template',
      entityId: templateId,
    });
  }
}

/** Compila el correo con el branding del tenant y lo personaliza para un destinatario. */
export class PreviewTemplateUseCase {
  constructor(private readonly deps: TemplateUseCaseDeps) {}

  async execute(context: TenantContext, input: z.infer<typeof previewTemplateSchema>) {
    assertCan(context, 'template:read');
    const [profile, fields, recipient] = await Promise.all([
      this.deps.branding.getEmailProfile(context),
      this.deps.fields.list(context),
      this.recipient(context, input.contactId),
    ]);
    const sender: EmailSender = {
      tenantName: profile.name,
      postalAddress: profile.postalAddress,
      branding: profile.branding,
      logoUrl: profile.branding.logoKey
        ? this.deps.assets.tenantLogo(context.tenantId, profile.branding.logoKey)
        : null,
    };
    const prepared = await this.deps.compiler.prepare({
      body: input.body,
      sender,
      documents: await this.documentAssets(context, input.body),
      fieldKeys: new Set(fields.map((field) => field.key)),
      forceColorScheme: input.colorScheme,
    });
    // Con errores de sintaxis Liquid no se puede personalizar: se muestra el correo sin variables.
    if (prepared.issues.some((issue) => issue.code === 'LIQUID_SYNTAX')) {
      return {
        subject: prepared.subject,
        html: prepared.html,
        text: prepared.text,
        sizeBytes: prepared.html.length,
        issues: prepared.issues,
      };
    }
    const rendered = await this.deps.compiler.personalize(
      prepared,
      buildRecipientVariables({
        recipient,
        tenantName: profile.name,
        links: PREVIEW_LINKS,
        now: this.deps.clock.now(),
      }),
    );
    return { ...rendered, issues: prepared.issues };
  }

  private async recipient(
    context: TenantContext,
    contactId: string | null,
  ): Promise<RecipientData> {
    if (!contactId) return SAMPLE_RECIPIENT;
    assertCan(context, 'contact:read');
    const contact = await this.deps.contacts.findById(context, contactId);
    if (!contact) throw new DomainError('NOT_FOUND', 'Contacto inexistente');
    return contact;
  }

  private async documentAssets(
    context: TenantContext,
    body: TemplateBody,
  ): Promise<Map<string, DocumentAsset>> {
    const ids = referencedDocumentIds(body);
    if (ids.length === 0) return new Map();
    const documents = await this.deps.documents.findManyByIds(context, ids);
    return new Map(
      documents.map((document) => [
        document.id,
        {
          id: document.id,
          title: document.title,
          kind: document.kind,
          status: document.status,
          pageCount: document.pageCount,
          sizeBytes: document.sizeBytes,
          thumbnailUrl: document.thumbnailKey
            ? this.deps.assets.documentThumbnail(context.tenantId, document.id)
            : null,
          thumbnailWidth: document.thumbnailWidth,
          thumbnailHeight: document.thumbnailHeight,
          downloadUrl: this.deps.assets.documentDownload(context.tenantId, document.id),
        },
      ]),
    );
  }
}
