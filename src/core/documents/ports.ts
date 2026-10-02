/** Puertos del módulo de documentos. Las implementaciones viven en src/infrastructure/documents. */
import type { TenantContext } from '@/core/shared/tenant-context';
import type {
  DocumentKind,
  DocumentQuery,
  DocumentRecord,
  DocumentStatus,
  DocumentSummary,
} from './document';

export type DocumentPatch = Partial<
  Pick<
    DocumentRecord,
    | 'title'
    | 'status'
    | 'error'
    | 'pdfKey'
    | 'thumbnailKey'
    | 'thumbnailWidth'
    | 'thumbnailHeight'
    | 'pageCount'
    | 'extractedText'
    | 'attempts'
    | 'processedAt'
  >
>;

export interface NewDocument {
  id: string;
  title: string;
  fileName: string;
  extension: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  createdById: string;
}

export interface DocumentRepository {
  create(context: TenantContext, input: NewDocument): Promise<DocumentRecord>;
  findById(context: TenantContext, documentId: string): Promise<DocumentRecord | null>;
  findManyByIds(context: TenantContext, documentIds: readonly string[]): Promise<DocumentSummary[]>;
  list(context: TenantContext, query: DocumentQuery): Promise<DocumentSummary[]>;
  update(context: TenantContext, documentId: string, patch: DocumentPatch): Promise<void>;
  /** Cambia el estado solo si el actual es uno de `from` (transición atómica). */
  transition(
    context: TenantContext,
    documentId: string,
    from: readonly DocumentStatus[],
    patch: DocumentPatch,
  ): Promise<boolean>;
  delete(context: TenantContext, documentId: string): Promise<boolean>;
}

export interface InspectedFile {
  kind: DocumentKind;
  mimeType: string;
  /** Extensión normalizada según el contenido real (no la declarada por el usuario). */
  extension: string;
}

/** Identifica el tipo real por el contenido (bytes mágicos); null si no está permitido. */
export interface FileInspector {
  inspect(fileName: string, bytes: Uint8Array): Promise<InspectedFile | null>;
}

/** Conversión a PDF (LibreOffice para ofimática, Chromium para HTML/Markdown/texto). */
export interface DocumentConverter {
  toPdf(input: { kind: DocumentKind; extension: string; bytes: Uint8Array }): Promise<Uint8Array>;
  /** Texto legible de los formatos de texto (HTML sin etiquetas, Markdown, texto plano). */
  textFromSource(kind: DocumentKind, bytes: Uint8Array): string;
}

export interface PdfToolkit {
  pageCount(pdf: Uint8Array): Promise<number>;
  /** Primera página como PNG con el ancho indicado. */
  renderFirstPage(pdf: Uint8Array, width: number): Promise<Uint8Array>;
  extractText(pdf: Uint8Array, maxPages: number): Promise<string>;
}

export interface ProcessedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  contentType: string;
}

export interface ImageProcessor {
  /** Miniatura JPEG del ancho indicado (sin ampliar imágenes pequeñas). */
  thumbnail(bytes: Uint8Array, width: number): Promise<ProcessedImage>;
  /** Logotipo normalizado a PNG (máx. 480×160, sin metadatos). */
  normalizeLogo(bytes: Uint8Array): Promise<ProcessedImage>;
}

export interface DocumentQueue {
  enqueue(context: TenantContext, documentId: string): Promise<void>;
}

/**
 * URLs públicas firmadas (HMAC) para los recursos que se muestran en los correos: miniaturas,
 * descargas e imagen del logotipo. No caducan, porque un correo puede abrirse meses después;
 * dejan de funcionar si el recurso se elimina.
 */
export interface PublicAssetLinks {
  documentThumbnail(tenantId: string, documentId: string): string;
  documentDownload(tenantId: string, documentId: string): string;
  tenantLogo(tenantId: string, logoKey: string): string;
}
