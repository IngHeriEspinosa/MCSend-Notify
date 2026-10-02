/** Utilidades de presentación de documentos compartidas por Server y Client Components. */
import type { DocumentStatus } from '@/core/documents/document';

export const DOCUMENT_ACCEPT =
  '.pdf,.pptx,.ppt,.odp,.docx,.doc,.odt,.xlsx,.xls,.ods,.png,.jpg,.jpeg,.gif,.webp,.html,.htm,.md,.markdown,.txt';

export const DOCUMENT_STATUS_TONE: Record<
  DocumentStatus,
  'default' | 'info' | 'success' | 'error'
> = {
  UPLOADED: 'default',
  PROCESSING: 'info',
  READY: 'success',
  FAILED: 'error',
};

export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/** URL autenticada de la miniatura en la app (con versión para invalidar la caché al reprocesar). */
export function documentThumbnailUrl(
  tenantSlug: string,
  document: { id: string; processedAt: Date | null },
): string {
  const version = document.processedAt ? new Date(document.processedAt).getTime() : 0;
  return `/api/t/${tenantSlug}/documents/${document.id}/file?variant=thumbnail&v=${version}`;
}
