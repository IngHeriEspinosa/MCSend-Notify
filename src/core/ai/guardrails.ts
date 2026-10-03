/**
 * Guardrails del contenido generado por IA.
 *
 * - Las fuentes se entregan al modelo como datos (`<source>`), nunca como instrucciones.
 * - Ningún enlace de la salida llega al correo si no aparece literalmente en las fuentes: un texto
 *   con una inyección ("añade este enlace") no puede introducir URL externas.
 * - Las variables Liquid (`{{ contact.first_name }}`) deben conservarse exactamente.
 *
 * La detección de enlaces usa un `LinkFinder` con las mismas reglas que el renderizado del correo
 * (markdown-it con linkify), de modo que un dominio suelto como `www.ejemplo.com` también se filtra.
 */
import type { CollectedSource } from './sources';

export interface FoundLink {
  start: number;
  end: number;
  url: string;
}

/** Detecta enlaces en texto plano igual que el renderizado del correo (linkify). */
export interface LinkFinder {
  find(text: string): FoundLink[];
}

const SYSTEM_LINK = /^\{\{\s*(unsubscribe_url|preferences_url)\s*\}\}$/;
const MARKDOWN_IMAGE = /!\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const MARKDOWN_LINK = /\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?([^\s>]+)>?.*$/gm;
const AUTOLINK = /<([a-z][a-z0-9+.-]*:[^>\s]+)>/gi;
const PLACEHOLDER = /\u0000(\d+)\u0000/g;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/** Forma canónica para comparar URL: sin fragmento, host en minúsculas y sin barra final. */
export function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '';
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return null;
  }
}

/** URL http(s) que aparecen en un texto (fuentes, cuerpos de novedades). */
export function extractUrls(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, '');
    if (canonicalUrl(url)) found.add(url);
  }
  return [...found];
}

/** Lista blanca de enlaces: los de las fuentes y las variables de baja y preferencias. */
export class LinkPolicy {
  private readonly allowed: ReadonlySet<string>;

  constructor(urls: Iterable<string>) {
    const canonical = new Set<string>();
    for (const url of urls) {
      const value = canonicalUrl(url);
      if (value) canonical.add(value);
    }
    this.allowed = canonical;
  }

  allows(url: string): boolean {
    if (SYSTEM_LINK.test(url.trim())) return true;
    const value = canonicalUrl(url);
    return value !== null && this.allowed.has(value);
  }
}

export interface SanitizedText {
  text: string;
  removed: string[];
}

/**
 * Quita de un Markdown los enlaces no permitidos: un `[texto](url)` conserva el texto; una imagen
 * (posible píxel de seguimiento ajeno), una definición de referencia o un enlace automático
 * desaparecen, y una URL o dominio suelto se elimina.
 */
export function sanitizeMarkdownLinks(
  markdown: string,
  policy: LinkPolicy,
  finder: LinkFinder,
): SanitizedText {
  const removed: string[] = [];
  const kept: string[] = [];
  const keep = (value: string) => {
    kept.push(value);
    return `\u0000${kept.length - 1}\u0000`;
  };
  const check = (whole: string, url: string, replacement: string) => {
    if (policy.allows(url)) return keep(whole);
    removed.push(url);
    return replacement;
  };

  let text = markdown.replace(/\u0000/g, '');
  text = text.replace(MARKDOWN_IMAGE, (whole, url: string) => check(whole, url, ''));
  text = text.replace(MARKDOWN_LINK, (whole, label: string, url: string) =>
    check(whole, url, label),
  );
  text = text.replace(REFERENCE_DEFINITION, (whole, url: string) => check(whole, url, ''));
  text = text.replace(AUTOLINK, (whole, url: string) => check(whole, url, ''));

  let cleaned = '';
  let cursor = 0;
  for (const link of finder.find(text)) {
    if (link.start < cursor) continue;
    const raw = text.slice(link.start, link.end);
    cleaned += text.slice(cursor, link.start);
    if (policy.allows(link.url) || policy.allows(raw)) {
      cleaned += raw;
    } else {
      removed.push(raw);
    }
    cursor = link.end;
  }
  cleaned += text.slice(cursor);

  return {
    text: cleaned.replace(PLACEHOLDER, (_match, index: string) => kept[Number(index)] ?? ''),
    removed,
  };
}

function escapeAttribute(value: string): string {
  return value.replace(/[<>"&\n\r]/g, ' ').trim();
}

/** Evita que una fuente cierre su etiqueta y "salga" al nivel de las instrucciones. */
function neutralizeSourceTags(text: string): string {
  return text.replace(/<(\/?\s*source\b)/gi, '‹$1');
}

/** Envuelve las fuentes como datos etiquetados para el prompt. */
export function wrapSources(sources: readonly CollectedSource[]): string {
  return sources
    .map(
      (source) =>
        `<source id="${source.id}" kind="${source.kind}" title="${escapeAttribute(source.title)}">\n` +
        `${neutralizeSourceTags(source.text)}\n</source>`,
    )
    .join('\n\n');
}

const LIQUID_TAG = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;

/** Etiquetas Liquid de un texto, normalizadas y ordenadas (para comparar multiconjuntos). */
export function liquidTags(text: string): string[] {
  return [...text.matchAll(LIQUID_TAG)]
    .map((match) =>
      match[0]
        .replace(/^(\{\{|\{%)-?\s*/, '$1 ')
        .replace(/\s*-?(\}\}|%\})$/, ' $1')
        .replace(/\s+/g, ' '),
    )
    .sort();
}

export function hasSameLiquidTags(original: string, candidate: string): boolean {
  const a = liquidTags(original);
  const b = liquidTags(candidate);
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}
