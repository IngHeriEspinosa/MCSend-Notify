/**
 * Casos de uso de documentos.
 *
 * - Subida: valida tamaño y tipo real, guarda el original y encola el procesamiento.
 * - Procesamiento (worker): PDF → número de páginas → miniatura de la primera página → texto.
 *   Es idempotente: solo procesa documentos UPLOADED o interrumpidos en PROCESSING.
 * - Consulta, renombrado, reintento y eliminación (borra también los archivos derivados).
 */
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type {
  ByteStream,
  Clock,
  ContentHasher,
  IdGenerator,
  ObjectStorage,
} from '@/core/shared/ports';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import {
  DocumentProcessingError,
  hasTextSource,
  MAX_DOCUMENT_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
  needsPdfConversion,
  TEXT_EXTRACTION_MAX_PAGES,
  THUMBNAIL_WIDTH,
  titleFromFileName,
  type DocumentErrorCode,
  type DocumentQuery,
  type DocumentRecord,
} from '../document';
import type {
  DocumentConverter,
  DocumentQueue,
  DocumentRepository,
  FileInspector,
  ImageProcessor,
  PdfToolkit,
} from '../ports';

export interface DocumentUseCaseDeps {
  documents: DocumentRepository;
  storage: ObjectStorage;
  inspector: FileInspector;
  converter: DocumentConverter;
  pdf: PdfToolkit;
  images: ImageProcessor;
  queue: DocumentQueue;
  hasher: ContentHasher;
  audit: AuditLogger;
  clock: Clock;
  ids: IdGenerator;
}

function documentPrefix(tenantId: string, documentId: string): string {
  return `tenants/${tenantId}/documents/${documentId}`;
}

export class UploadDocumentUseCase {
  constructor(private readonly deps: DocumentUseCaseDeps) {}

  async execute(
    context: TenantContext,
    input: { fileName: string; bytes: Uint8Array },
  ): Promise<DocumentRecord> {
    assertCan(context, 'document:write');
    const userId = actorUserId(context);
    if (!userId) throw new DomainError('FORBIDDEN', 'Solo un usuario puede subir documentos');
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new DomainError('VALIDATION', 'Tamaño de archivo no permitido', {
        reason: 'FILE_SIZE',
      });
    }
    const inspected = await this.deps.inspector.inspect(input.fileName, input.bytes);
    if (!inspected) {
      throw new DomainError('VALIDATION', 'Tipo de archivo no permitido', { reason: 'FILE_TYPE' });
    }

    const id = this.deps.ids.uuid();
    const storageKey = `${documentPrefix(context.tenantId, id)}/original.${inspected.extension}`;
    await this.deps.storage.put(storageKey, input.bytes, inspected.mimeType);
    const record = await this.deps.documents.create(context, {
      id,
      title: titleFromFileName(input.fileName),
      fileName: input.fileName.slice(0, 255),
      extension: inspected.extension,
      kind: inspected.kind,
      mimeType: inspected.mimeType,
      sizeBytes: input.bytes.byteLength,
      sha256: this.deps.hasher.sha256(input.bytes),
      storageKey,
      createdById: userId,
    });
    await this.deps.queue.enqueue(context, record.id);
    await this.deps.audit.record(context, {
      action: 'document.uploaded',
      entityType: 'document',
      entityId: record.id,
      metadata: { kind: record.kind, bytes: record.sizeBytes },
    });
    return record;
  }
}

function toErrorCode(error: unknown): DocumentErrorCode {
  return error instanceof DocumentProcessingError ? error.code : 'PROCESSING_ERROR';
}

export class ProcessDocumentUseCase {
  constructor(private readonly deps: DocumentUseCaseDeps) {}

  /**
   * @param options.finalAttempt si es el último intento, un error deja el documento en FAILED;
   * en otro caso se relanza para que la cola reintente con backoff.
   */
  async execute(
    context: TenantContext,
    documentId: string,
    options: { finalAttempt: boolean },
  ): Promise<void> {
    const record = await this.deps.documents.findById(context, documentId);
    if (!record || (record.status !== 'UPLOADED' && record.status !== 'PROCESSING')) return;
    await this.deps.documents.update(context, documentId, {
      status: 'PROCESSING',
      attempts: record.attempts + 1,
      error: null,
    });

    try {
      const patch = await this.process(context, record);
      await this.deps.documents.update(context, documentId, {
        ...patch,
        status: 'READY',
        error: null,
        processedAt: this.deps.clock.now(),
      });
      await this.deps.audit.record(context, {
        action: 'document.processed',
        entityType: 'document',
        entityId: documentId,
        metadata: { kind: record.kind, pageCount: patch.pageCount },
      });
    } catch (error) {
      if (!options.finalAttempt) throw error;
      await this.deps.documents.update(context, documentId, {
        status: 'FAILED',
        error: toErrorCode(error),
        processedAt: this.deps.clock.now(),
      });
      throw error;
    }
  }

  private async process(context: TenantContext, record: DocumentRecord) {
    const prefix = documentPrefix(context.tenantId, record.id);
    const original = await this.deps.storage.getBytes(record.storageKey);

    if (record.kind === 'IMAGE') {
      const thumbnail = await this.deps.images.thumbnail(original, THUMBNAIL_WIDTH);
      const thumbnailKey = `${prefix}/thumbnail.jpg`;
      await this.deps.storage.put(thumbnailKey, thumbnail.bytes, thumbnail.contentType);
      return {
        pdfKey: null,
        thumbnailKey,
        thumbnailWidth: thumbnail.width,
        thumbnailHeight: thumbnail.height,
        pageCount: 1,
        extractedText: null,
      };
    }

    let pdf = original;
    let pdfKey: string | null = null;
    if (needsPdfConversion(record.kind)) {
      pdf = await this.deps.converter.toPdf({
        kind: record.kind,
        extension: record.extension,
        bytes: original,
      });
      pdfKey = `${prefix}/document.pdf`;
      await this.deps.storage.put(pdfKey, pdf, 'application/pdf');
    }

    const pageCount = await this.deps.pdf.pageCount(pdf);
    const page = await this.deps.pdf.renderFirstPage(pdf, THUMBNAIL_WIDTH);
    const thumbnail = await this.deps.images.thumbnail(page, THUMBNAIL_WIDTH);
    const thumbnailKey = `${prefix}/thumbnail.jpg`;
    await this.deps.storage.put(thumbnailKey, thumbnail.bytes, thumbnail.contentType);

    const text = hasTextSource(record.kind)
      ? this.deps.converter.textFromSource(record.kind, original)
      : await this.deps.pdf.extractText(pdf, TEXT_EXTRACTION_MAX_PAGES);

    return {
      pdfKey,
      thumbnailKey,
      thumbnailWidth: thumbnail.width,
      thumbnailHeight: thumbnail.height,
      pageCount,
      extractedText: text.trim().slice(0, MAX_EXTRACTED_TEXT_CHARS) || null,
    };
  }
}

export type DocumentFileVariant = 'original' | 'pdf' | 'thumbnail';

export interface DocumentFile {
  stream: ByteStream;
  contentType: string;
  record: DocumentRecord;
}

/** Consultas y mantenimiento de documentos desde la interfaz. */
export class ManageDocumentsUseCase {
  constructor(
    private readonly deps: Pick<
      DocumentUseCaseDeps,
      'documents' | 'storage' | 'queue' | 'audit' | 'clock'
    >,
  ) {}

  list(context: TenantContext, query: DocumentQuery) {
    assertCan(context, 'document:read');
    return this.deps.documents.list(context, query);
  }

  async get(context: TenantContext, documentId: string): Promise<DocumentRecord> {
    assertCan(context, 'document:read');
    const record = await this.deps.documents.findById(context, documentId);
    if (!record) throw new DomainError('NOT_FOUND', 'Documento inexistente');
    return record;
  }

  async file(
    context: TenantContext,
    documentId: string,
    variant: DocumentFileVariant,
  ): Promise<DocumentFile> {
    const record = await this.get(context, documentId);
    return openDocumentFile(this.deps.storage, record, variant);
  }

  async rename(context: TenantContext, documentId: string, title: string) {
    assertCan(context, 'document:write');
    await this.get(context, documentId);
    await this.deps.documents.update(context, documentId, { title });
    await this.deps.audit.record(context, {
      action: 'document.renamed',
      entityType: 'document',
      entityId: documentId,
    });
  }

  async retry(context: TenantContext, documentId: string) {
    assertCan(context, 'document:write');
    const changed = await this.deps.documents.transition(context, documentId, ['FAILED'], {
      status: 'UPLOADED',
      error: null,
      attempts: 0,
    });
    if (!changed) throw new DomainError('INVALID_STATE', 'Solo se reintentan documentos fallidos');
    await this.deps.queue.enqueue(context, documentId);
    await this.deps.audit.record(context, {
      action: 'document.retried',
      entityType: 'document',
      entityId: documentId,
    });
  }

  async delete(context: TenantContext, documentId: string) {
    assertCan(context, 'document:write');
    const record = await this.get(context, documentId);
    const keys = [record.storageKey, record.pdfKey, record.thumbnailKey].filter(
      (key): key is string => key !== null,
    );
    await this.deps.documents.delete(context, documentId);
    // Los archivos se borran después del registro: si falla el borrado quedan huérfanos,
    // nunca un registro apuntando a archivos inexistentes.
    await Promise.allSettled(keys.map((key) => this.deps.storage.delete(key)));
    await this.deps.audit.record(context, {
      action: 'document.deleted',
      entityType: 'document',
      entityId: documentId,
      metadata: { title: record.title },
    });
  }
}

export async function openDocumentFile(
  storage: ObjectStorage,
  record: DocumentRecord,
  variant: DocumentFileVariant,
): Promise<DocumentFile> {
  const key =
    variant === 'original'
      ? record.storageKey
      : variant === 'pdf'
        ? (record.pdfKey ?? (record.kind === 'PDF' ? record.storageKey : null))
        : record.thumbnailKey;
  if (!key) throw new DomainError('NOT_FOUND', 'El documento no tiene ese archivo');
  const contentType =
    variant === 'original' ? record.mimeType : variant === 'pdf' ? 'application/pdf' : 'image/jpeg';
  return { stream: await storage.getStream(key), contentType, record };
}
