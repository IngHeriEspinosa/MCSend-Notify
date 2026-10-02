/** Puertos del módulo de plantillas: persistencia con versiones y compilación del correo. */
import type { DocumentKind, DocumentStatus } from '@/core/documents/document';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { TenantBranding } from '@/core/tenants/branding';
import type { TemplateBody, TemplateFormat } from './email-content';
import type { RecipientVariables } from './template-variables';
import type { TemplateIssue } from './template-issues';

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  format: TemplateFormat;
  subject: string;
  locale: 'es' | 'en';
  currentVersion: number;
  updatedAt: Date;
}

export interface TemplateRecord extends TemplateSummary {
  body: TemplateBody;
  createdAt: Date;
}

export interface TemplateVersionSummary {
  version: number;
  subject: string;
  note: string | null;
  createdById: string;
  createdByName: string | null;
  createdAt: Date;
}

export interface TemplateVersionRecord extends TemplateVersionSummary {
  body: TemplateBody;
}

export interface TemplateWrite {
  name: string;
  description: string | null;
  body: TemplateBody;
  note: string | null;
  userId: string;
}

export interface TemplateRepository {
  list(context: TenantContext): Promise<TemplateSummary[]>;
  findById(context: TenantContext, templateId: string): Promise<TemplateRecord | null>;
  /** Crea la plantilla y su versión 1 en una transacción. CONFLICT si el nombre existe. */
  create(context: TenantContext, input: TemplateWrite): Promise<TemplateRecord>;
  /**
   * Guarda una versión nueva si `expectedVersion` coincide con la vigente (concurrencia optimista).
   * Devuelve null si otra persona guardó antes.
   */
  saveVersion(
    context: TenantContext,
    templateId: string,
    expectedVersion: number,
    input: TemplateWrite,
  ): Promise<TemplateRecord | null>;
  listVersions(context: TenantContext, templateId: string): Promise<TemplateVersionSummary[]>;
  findVersion(
    context: TenantContext,
    templateId: string,
    version: number,
  ): Promise<TemplateVersionRecord | null>;
  delete(context: TenantContext, templateId: string): Promise<boolean>;
}

/** Datos de un documento necesarios para pintar su tarjeta o imagen en el correo. */
export interface DocumentAsset {
  id: string;
  title: string;
  kind: DocumentKind;
  status: DocumentStatus;
  pageCount: number | null;
  sizeBytes: number;
  thumbnailUrl: string | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  downloadUrl: string;
}

export interface EmailSender {
  tenantName: string;
  postalAddress: string | null;
  branding: TenantBranding;
  logoUrl: string | null;
}

export interface PrepareEmailInput {
  body: TemplateBody;
  sender: EmailSender;
  documents: ReadonlyMap<string, DocumentAsset>;
  fieldKeys: ReadonlySet<string>;
  /** Solo para la vista previa: fuerza la paleta oscura sin depender del sistema. */
  forceColorScheme?: 'light' | 'dark' | undefined;
}

/** Correo compilado una vez por envío: HTML y texto con variables Liquid pendientes. */
export interface PreparedEmail {
  subject: string;
  html: string;
  text: string;
  issues: TemplateIssue[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  sizeBytes: number;
}

export interface EmailCompiler {
  prepare(input: PrepareEmailInput): Promise<PreparedEmail>;
  /** Sustituye las variables de un destinatario (con escape HTML en el cuerpo). */
  personalize(prepared: PreparedEmail, variables: RecipientVariables): Promise<RenderedEmail>;
}
