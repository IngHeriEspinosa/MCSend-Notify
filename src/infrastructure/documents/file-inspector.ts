/**
 * Identificación del tipo real de un archivo por su contenido (OWASP A04: no confiar en la
 * extensión ni en el MIME declarado). Lista blanca de formatos; SVG, ejecutables, comprimidos y
 * cualquier otro tipo se rechazan.
 */
import { fileTypeFromBuffer } from 'file-type';
import type { DocumentKind } from '@/core/documents/document';
import type { FileInspector, InspectedFile } from '@/core/documents/ports';

const BINARY_TYPES: Record<string, { kind: DocumentKind; mimeType: string }> = {
  pdf: { kind: 'PDF', mimeType: 'application/pdf' },
  png: { kind: 'IMAGE', mimeType: 'image/png' },
  jpg: { kind: 'IMAGE', mimeType: 'image/jpeg' },
  gif: { kind: 'IMAGE', mimeType: 'image/gif' },
  webp: { kind: 'IMAGE', mimeType: 'image/webp' },
  pptx: {
    kind: 'PRESENTATION',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  docx: {
    kind: 'DOCUMENT',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    kind: 'SPREADSHEET',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  odp: { kind: 'PRESENTATION', mimeType: 'application/vnd.oasis.opendocument.presentation' },
  odt: { kind: 'DOCUMENT', mimeType: 'application/vnd.oasis.opendocument.text' },
  ods: { kind: 'SPREADSHEET', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' },
};

/** Formatos antiguos de Office (contenedor OLE/CFB): el subtipo solo se distingue por extensión. */
const LEGACY_OFFICE: Record<string, { kind: DocumentKind; mimeType: string }> = {
  ppt: { kind: 'PRESENTATION', mimeType: 'application/vnd.ms-powerpoint' },
  doc: { kind: 'DOCUMENT', mimeType: 'application/msword' },
  xls: { kind: 'SPREADSHEET', mimeType: 'application/vnd.ms-excel' },
};

const TEXT_TYPES: Record<string, { kind: DocumentKind; mimeType: string; extension: string }> = {
  html: { kind: 'HTML', mimeType: 'text/html', extension: 'html' },
  htm: { kind: 'HTML', mimeType: 'text/html', extension: 'html' },
  md: { kind: 'MARKDOWN', mimeType: 'text/markdown', extension: 'md' },
  markdown: { kind: 'MARKDOWN', mimeType: 'text/markdown', extension: 'md' },
  txt: { kind: 'TEXT', mimeType: 'text/plain', extension: 'txt' },
};

function declaredExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? '';
}

/** Texto UTF-8 válido y sin bytes nulos (descarta binarios renombrados como .txt/.md/.html). */
function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export class MagicBytesFileInspector implements FileInspector {
  async inspect(fileName: string, bytes: Uint8Array): Promise<InspectedFile | null> {
    const extension = declaredExtension(fileName);
    const detected = await fileTypeFromBuffer(bytes);

    if (detected) {
      if (detected.ext === 'cfb') {
        const legacy = LEGACY_OFFICE[extension];
        return legacy ? { ...legacy, extension } : null;
      }
      const known = BINARY_TYPES[detected.ext];
      return known ? { ...known, extension: detected.ext } : null;
    }

    const text = TEXT_TYPES[extension];
    if (text && isUtf8Text(bytes)) {
      return { kind: text.kind, mimeType: text.mimeType, extension: text.extension };
    }
    return null;
  }
}
