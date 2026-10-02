/**
 * Documentos del tenant: tipos admitidos, estados y modelo de lectura.
 *
 * Flujo: UPLOADED → PROCESSING → READY | FAILED. El worker convierte el original a PDF
 * (salvo imágenes), genera la miniatura de la primera página y extrae el texto.
 */
import { z } from 'zod';

export const DOCUMENT_KINDS = [
  'PDF',
  'PRESENTATION',
  'DOCUMENT',
  'SPREADSHEET',
  'IMAGE',
  'HTML',
  'MARKDOWN',
  'TEXT',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = ['UPLOADED', 'PROCESSING', 'READY', 'FAILED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
/** Páginas de las que se extrae texto y tope del texto guardado. */
export const TEXT_EXTRACTION_MAX_PAGES = 20;
export const MAX_EXTRACTED_TEXT_CHARS = 200_000;
/** Ancho de la miniatura (el doble del ancho mostrado en el correo, para pantallas de alta densidad). */
export const THUMBNAIL_WIDTH = 1200;

/** Códigos de error de procesamiento que la UI traduce. */
export const DOCUMENT_ERROR_CODES = [
  'CONVERSION_FAILED',
  'RENDER_FAILED',
  'TOOLS_UNAVAILABLE',
  'INVALID_FILE',
  'PROCESSING_ERROR',
] as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

export class DocumentProcessingError extends Error {
  constructor(
    readonly code: DocumentErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'DocumentProcessingError';
  }
}

/** Tipos que necesitan conversión a PDF para obtener miniatura, páginas y texto. */
export function needsPdfConversion(kind: DocumentKind): boolean {
  return kind !== 'PDF' && kind !== 'IMAGE';
}

/** Tipos cuyo texto se lee directamente del original (no del PDF convertido). */
export function hasTextSource(kind: DocumentKind): boolean {
  return kind === 'HTML' || kind === 'MARKDOWN' || kind === 'TEXT';
}

export interface DocumentSummary {
  id: string;
  title: string;
  fileName: string;
  extension: string;
  kind: DocumentKind;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  error: string | null;
  pageCount: number | null;
  thumbnailKey: string | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface DocumentRecord extends DocumentSummary {
  sha256: string;
  storageKey: string;
  pdfKey: string | null;
  extractedText: string | null;
  attempts: number;
  createdById: string;
}

export const documentQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
});

export type DocumentQuery = z.infer<typeof documentQuerySchema>;

export const renameDocumentSchema = z.object({
  documentId: z.uuid(),
  title: z.string().trim().min(1).max(200),
});

/** Título inicial a partir del nombre del archivo, sin extensión ni caracteres de control. */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  const clean = Array.from(base)
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join('')
    .trim();
  return (clean || 'Documento').slice(0, 200);
}

/** Nombre de archivo seguro para cabeceras de descarga (solo ASCII imprimible sin comillas). */
export function safeDownloadName(title: string, extension: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .trim()
    .slice(0, 120);
  return `${base || 'documento'}.${extension}`;
}
