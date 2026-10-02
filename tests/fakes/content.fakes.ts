/** Dobles en memoria de documentos, almacenamiento y plantillas para tests unitarios. */
import type {
  DocumentKind,
  DocumentQuery,
  DocumentRecord,
  DocumentStatus,
  DocumentSummary,
} from '@/core/documents/document';
import type {
  DocumentConverter,
  DocumentPatch,
  DocumentQueue,
  DocumentRepository,
  FileInspector,
  ImageProcessor,
  InspectedFile,
  NewDocument,
  PdfToolkit,
  ProcessedImage,
  PublicAssetLinks,
} from '@/core/documents/ports';
import type { ByteStream, ObjectStorage } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type {
  TemplateRecord,
  TemplateRepository,
  TemplateSummary,
  TemplateVersionRecord,
  TemplateWrite,
} from '@/core/templates/ports';
import {
  DEFAULT_BRANDING,
  type BrandingRepository,
  type TenantBranding,
  type TenantEmailProfile,
} from '@/core/tenants/branding';

export class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array | ByteStream, contentType: string): Promise<void> {
    if (body instanceof Uint8Array) {
      this.objects.set(key, { bytes: body, contentType });
      return;
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) chunks.push(chunk);
    this.objects.set(key, { bytes: Buffer.concat(chunks), contentType });
  }

  async getBytes(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`NoSuchKey: ${key}`);
    return object.bytes;
  }

  async getStream(key: string): Promise<ByteStream> {
    const bytes = await this.getBytes(key);
    return (async function* () {
      yield bytes;
    })();
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, DocumentRecord & { tenantId: string }>();

  async create(context: TenantContext, input: NewDocument): Promise<DocumentRecord> {
    const record: DocumentRecord & { tenantId: string } = {
      ...input,
      tenantId: context.tenantId,
      status: 'UPLOADED',
      error: null,
      pageCount: null,
      thumbnailKey: null,
      thumbnailWidth: null,
      thumbnailHeight: null,
      pdfKey: null,
      extractedText: null,
      attempts: 0,
      createdAt: new Date('2026-10-02T12:00:00.000Z'),
      processedAt: null,
    };
    this.documents.set(input.id, record);
    return record;
  }

  async findById(context: TenantContext, documentId: string): Promise<DocumentRecord | null> {
    const record = this.documents.get(documentId);
    return record?.tenantId === context.tenantId ? { ...record } : null;
  }

  async findManyByIds(context: TenantContext, ids: readonly string[]): Promise<DocumentSummary[]> {
    return [...this.documents.values()].filter(
      (record) => record.tenantId === context.tenantId && ids.includes(record.id),
    );
  }

  async list(context: TenantContext, query: DocumentQuery): Promise<DocumentSummary[]> {
    return [...this.documents.values()].filter(
      (record) =>
        record.tenantId === context.tenantId && (!query.status || record.status === query.status),
    );
  }

  async update(context: TenantContext, documentId: string, patch: DocumentPatch): Promise<void> {
    const record = this.documents.get(documentId);
    if (record?.tenantId === context.tenantId) {
      this.documents.set(documentId, { ...record, ...patch });
    }
  }

  async transition(
    context: TenantContext,
    documentId: string,
    from: readonly DocumentStatus[],
    patch: DocumentPatch,
  ): Promise<boolean> {
    const record = this.documents.get(documentId);
    if (record?.tenantId !== context.tenantId || !from.includes(record.status)) return false;
    this.documents.set(documentId, { ...record, ...patch });
    return true;
  }

  async delete(context: TenantContext, documentId: string): Promise<boolean> {
    const record = this.documents.get(documentId);
    if (record?.tenantId !== context.tenantId) return false;
    return this.documents.delete(documentId);
  }
}

/** Inspector controlado por el test: devuelve el tipo configurado por extensión. */
export class FakeFileInspector implements FileInspector {
  constructor(private readonly types: Record<string, InspectedFile> = {}) {}
  async inspect(fileName: string): Promise<InspectedFile | null> {
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    return this.types[extension] ?? null;
  }
}

export class FakeDocumentConverter implements DocumentConverter {
  readonly calls: Array<{ kind: DocumentKind; extension: string }> = [];
  failWith: Error | null = null;
  async toPdf(input: { kind: DocumentKind; extension: string; bytes: Uint8Array }) {
    this.calls.push({ kind: input.kind, extension: input.extension });
    if (this.failWith) throw this.failWith;
    return new TextEncoder().encode(`%PDF converted ${input.extension}`);
  }
  textFromSource(_kind: DocumentKind, bytes: Uint8Array): string {
    return `texto: ${new TextDecoder().decode(bytes)}`;
  }
}

export class FakePdfToolkit implements PdfToolkit {
  pages = 4;
  async pageCount(): Promise<number> {
    return this.pages;
  }
  async renderFirstPage(): Promise<Uint8Array> {
    return new TextEncoder().encode('png-page-1');
  }
  async extractText(): Promise<string> {
    return 'Texto extraído del PDF';
  }
}

export class FakeImageProcessor implements ImageProcessor {
  async thumbnail(bytes: Uint8Array, width: number): Promise<ProcessedImage> {
    return { bytes, width, height: Math.round((width * 9) / 16), contentType: 'image/jpeg' };
  }
  async normalizeLogo(bytes: Uint8Array): Promise<ProcessedImage> {
    return { bytes, width: 240, height: 80, contentType: 'image/png' };
  }
}

export class RecordingDocumentQueue implements DocumentQueue {
  readonly enqueued: string[] = [];
  async enqueue(_context: TenantContext, documentId: string): Promise<void> {
    this.enqueued.push(documentId);
  }
}

export const fakeAssetLinks: PublicAssetLinks = {
  documentThumbnail: (tenantId, documentId) =>
    `https://app.test/trk/i/thumb-${tenantId}-${documentId}`,
  documentDownload: (tenantId, documentId) =>
    `https://app.test/trk/d/file-${tenantId}-${documentId}`,
  tenantLogo: (tenantId) => `https://app.test/trk/i/logo-${tenantId}`,
};

export class InMemoryBrandingRepository implements BrandingRepository {
  profile: TenantEmailProfile = {
    name: 'MCSupport',
    postalAddress: 'Av. Lincoln 1007, Santo Domingo',
    defaultLocale: 'es',
    branding: { ...DEFAULT_BRANDING },
  };
  async getEmailProfile(): Promise<TenantEmailProfile> {
    return { ...this.profile, branding: { ...this.profile.branding } };
  }
  async saveBranding(_context: TenantContext, branding: TenantBranding): Promise<void> {
    this.profile = { ...this.profile, branding };
  }
}

export class InMemoryTemplateRepository implements TemplateRepository {
  readonly templates = new Map<string, TemplateRecord>();
  readonly versions = new Map<string, TemplateVersionRecord[]>();
  private sequence = 0;

  async list(): Promise<TemplateSummary[]> {
    return [...this.templates.values()];
  }

  async findById(_context: TenantContext, templateId: string): Promise<TemplateRecord | null> {
    return this.templates.get(templateId) ?? null;
  }

  async create(_context: TenantContext, input: TemplateWrite): Promise<TemplateRecord> {
    this.sequence += 1;
    const id = `00000000-0000-7000-8000-${String(this.sequence).padStart(12, '0')}`;
    const record = this.toRecord(id, 1, input);
    this.templates.set(id, record);
    this.versions.set(id, [this.toVersion(1, input)]);
    return record;
  }

  async saveVersion(
    _context: TenantContext,
    templateId: string,
    expectedVersion: number,
    input: TemplateWrite,
  ): Promise<TemplateRecord | null> {
    const current = this.templates.get(templateId);
    if (current?.currentVersion !== expectedVersion) return null;
    const record = this.toRecord(templateId, expectedVersion + 1, input);
    this.templates.set(templateId, record);
    this.versions.get(templateId)?.push(this.toVersion(expectedVersion + 1, input));
    return record;
  }

  async listVersions(_context: TenantContext, templateId: string) {
    return [...(this.versions.get(templateId) ?? [])].reverse();
  }

  async findVersion(_context: TenantContext, templateId: string, version: number) {
    return this.versions.get(templateId)?.find((item) => item.version === version) ?? null;
  }

  async delete(_context: TenantContext, templateId: string): Promise<boolean> {
    this.versions.delete(templateId);
    return this.templates.delete(templateId);
  }

  private toRecord(id: string, version: number, input: TemplateWrite): TemplateRecord {
    return {
      id,
      name: input.name,
      description: input.description,
      format: input.body.format,
      subject: input.body.subject,
      locale: input.body.locale,
      currentVersion: version,
      updatedAt: new Date('2026-10-02T12:00:00.000Z'),
      createdAt: new Date('2026-10-02T12:00:00.000Z'),
      body: input.body,
    };
  }

  private toVersion(version: number, input: TemplateWrite): TemplateVersionRecord {
    return {
      version,
      subject: input.body.subject,
      note: input.note,
      createdById: input.userId,
      createdByName: null,
      createdAt: new Date('2026-10-02T12:00:00.000Z'),
      body: input.body,
    };
  }
}
