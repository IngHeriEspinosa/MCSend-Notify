/**
 * Conversión a PDF con Gotenberg 8:
 * - Ofimática (PPTX, DOCX, XLSX, ODP, PPT...): LibreOffice (`/forms/libreoffice/convert`).
 * - HTML, Markdown y texto: Chromium (`/forms/chromium/convert/html`).
 *
 * Seguridad: Gotenberg corre en la red interna sin JavaScript y sin acceso a URL externas
 * (`--chromium-disable-javascript`, `--chromium-allow-list` en compose.yaml), de modo que un HTML
 * subido no puede ejecutar código ni hacer peticiones (SSRF).
 */
import markdownIt from 'markdown-it';
import { DocumentProcessingError, type DocumentKind } from '@/core/documents/document';
import type { DocumentConverter } from '@/core/documents/ports';
import { htmlToPlainText } from '../rendering/email-sanitizer';
import { decodeEntities, escapeHtml } from '../rendering/html';

const CONVERSION_TIMEOUT_MS = 150_000;

const PAGE_CSS = `body { font-family: 'Liberation Sans', Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #1F2328; margin: 0; }
h1, h2, h3 { color: #005E7D; } pre, code { font-family: 'Liberation Mono', monospace; font-size: 10pt; }
pre { white-space: pre-wrap; } table { border-collapse: collapse; } td, th { border: 1px solid #DADCE0; padding: 4px 8px; }
img { max-width: 100%; }`;

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body>${body}</body></html>`;
}

const CHARSET_DECLARATION = /<meta[^>]+charset/i;
const DOCTYPE = /^\s*<!doctype[^>]*>/i;

/**
 * El inspector ya garantiza que el HTML es UTF-8 válido; si no lo declara, Chromium lo leería
 * como Windows-1252 y los acentos saldrían mal en la miniatura. Se declara tras el doctype.
 */
export function ensureUtf8Charset(html: string): string {
  if (CHARSET_DECLARATION.test(html.slice(0, 2048))) return html;
  const meta = '<meta charset="utf-8">';
  const doctype = DOCTYPE.exec(html)?.[0];
  return doctype ? `${doctype}${meta}${html.slice(doctype.length)}` : `${meta}${html}`;
}

export class GotenbergDocumentConverter implements DocumentConverter {
  private readonly markdown = markdownIt({ html: false, linkify: true });

  constructor(private readonly baseUrl: string) {}

  async toPdf(input: {
    kind: DocumentKind;
    extension: string;
    bytes: Uint8Array;
  }): Promise<Uint8Array> {
    switch (input.kind) {
      case 'PRESENTATION':
      case 'DOCUMENT':
      case 'SPREADSHEET':
        return this.post(
          '/forms/libreoffice/convert',
          `document.${input.extension}`,
          input.bytes,
          {},
        );
      case 'HTML':
        return this.chromium(
          new TextEncoder().encode(ensureUtf8Charset(new TextDecoder().decode(input.bytes))),
        );
      case 'MARKDOWN': {
        const source = new TextDecoder().decode(input.bytes);
        return this.chromium(
          new TextEncoder().encode(htmlPage('Documento', this.markdown.render(source))),
        );
      }
      case 'TEXT': {
        const source = new TextDecoder().decode(input.bytes);
        return this.chromium(
          new TextEncoder().encode(htmlPage('Documento', `<pre>${escapeHtml(source)}</pre>`)),
        );
      }
      case 'PDF':
      case 'IMAGE':
        throw new DocumentProcessingError('INVALID_FILE', `El tipo ${input.kind} no se convierte`);
    }
  }

  textFromSource(kind: DocumentKind, bytes: Uint8Array): string {
    const source = new TextDecoder().decode(bytes);
    if (kind === 'HTML') return decodeEntities(htmlToPlainText(source)).replace(/\n{3,}/g, '\n\n');
    return source;
  }

  private chromium(html: Uint8Array): Promise<Uint8Array> {
    return this.post('/forms/chromium/convert/html', 'index.html', html, {
      paperWidth: '8.27',
      paperHeight: '11.7',
      marginTop: '0.5',
      marginBottom: '0.5',
      marginLeft: '0.5',
      marginRight: '0.5',
      printBackground: 'true',
    });
  }

  private async post(
    path: string,
    fileName: string,
    bytes: Uint8Array,
    fields: Record<string, string>,
  ): Promise<Uint8Array> {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(bytes)]), fileName);
    for (const [name, value] of Object.entries(fields)) form.append(name, value);

    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(CONVERSION_TIMEOUT_MS),
      });
    } catch (error) {
      throw new DocumentProcessingError('CONVERSION_FAILED', 'Gotenberg no respondió', {
        cause: error,
      });
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new DocumentProcessingError(
        'CONVERSION_FAILED',
        `Gotenberg respondió ${response.status}: ${detail}`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
