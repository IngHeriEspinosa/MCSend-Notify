/**
 * Composición de un correo a partir del cuerpo de una plantilla: reúne el perfil del remitente
 * (marca, dirección postal, logotipo), los documentos referenciados y los campos del tenant, y lo
 * prepara con el compilador. Lo usan la vista previa de plantillas y las campañas.
 */
import type { DocumentRepository, PublicAssetLinks } from '@/core/documents/ports';
import type { ContactFieldRepository } from '@/core/contacts/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { BrandingRepository } from '@/core/tenants/branding';
import { referencedDocumentIds, type TemplateBody } from './email-content';
import type { DocumentAsset, EmailCompiler, PreparedEmail } from './ports';

export interface EmailComposerDeps {
  branding: BrandingRepository;
  fields: ContactFieldRepository;
  documents: DocumentRepository;
  assets: PublicAssetLinks;
  compiler: EmailCompiler;
}

export interface ComposedEmail {
  prepared: PreparedEmail;
  tenantName: string;
}

export class EmailComposer {
  constructor(private readonly deps: EmailComposerDeps) {}

  async prepare(
    context: TenantContext,
    body: TemplateBody,
    options: { forceColorScheme?: 'light' | 'dark' | undefined } = {},
  ): Promise<ComposedEmail> {
    const [profile, fields, documents] = await Promise.all([
      this.deps.branding.getEmailProfile(context),
      this.deps.fields.list(context),
      this.documentAssets(context, body),
    ]);
    const prepared = await this.deps.compiler.prepare({
      body,
      sender: {
        tenantName: profile.name,
        postalAddress: profile.postalAddress,
        branding: profile.branding,
        logoUrl: profile.branding.logoKey
          ? this.deps.assets.tenantLogo(context.tenantId, profile.branding.logoKey)
          : null,
      },
      documents,
      fieldKeys: new Set(fields.map((field) => field.key)),
      forceColorScheme: options.forceColorScheme,
    });
    return { prepared, tenantName: profile.name };
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

/** Personaliza o, si hay errores de sintaxis Liquid, devuelve el correo sin variables. */
export function hasLiquidSyntaxError(prepared: PreparedEmail): boolean {
  return prepared.issues.some((issue) => issue.code === 'LIQUID_SYNTAX');
}
