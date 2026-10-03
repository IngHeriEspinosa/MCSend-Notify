/**
 * Descarga de fuentes públicas para la IA con `safeFetch` (solo hosts públicos, puertos 80/443,
 * 2 MB, 10 s): páginas HTML convertidas a texto y feeds RSS 2.0 / Atom.
 *
 * El XML se rechaza si declara DOCTYPE o entidades (XXE y "billion laughs") antes de analizarlo.
 */
import { XMLParser } from 'fast-xml-parser';
import sanitizeHtml from 'sanitize-html';
import {
  SourceFetchError,
  type FetchedFeed,
  type FetchedPage,
  type SourceFetcher,
} from '@/core/ai/sources';
import { safeFetch, SafeFetchError, type SafeFetchOptions } from '../security/safe-fetch';

const PAGE_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown'];
const FEED_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'application/rdf+xml',
];
const NON_TEXT_TAGS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'form',
  'nav',
  'header',
  'footer',
  'aside',
  'textarea',
  'select',
];
const MAX_LINKS = 50;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** HTML → texto legible: quita navegación, scripts y estilos y conserva los saltos de bloque. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|h[1-6]|blockquote|pre|table|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ');
  const text = sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: NON_TEXT_TAGS,
  });
  return decodeEntities(text)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Contenido principal (`<main>`, `<article>` o `<body>`), título y enlaces absolutos. */
export function parsePage(html: string, baseUrl: string): Omit<FetchedPage, 'url'> {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const main =
    /<main[\s>][\s\S]*?<\/main>/i.exec(html)?.[0] ??
    /<article[\s>][\s\S]*?<\/article>/i.exec(html)?.[0] ??
    /<body[\s>][\s\S]*?<\/body>/i.exec(html)?.[0] ??
    html;
  const links = new Set<string>();
  for (const match of main.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    if (links.size >= MAX_LINKS) break;
    try {
      const url = new URL(decodeEntities(match[1] ?? ''), baseUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        url.hash = '';
        links.add(url.toString());
      }
    } catch {
      // Enlace relativo inválido: se ignora.
    }
  }
  return { title, text: htmlToText(main), links: [...links] };
}

type XmlValue = string | number | boolean | XmlNode | XmlValue[] | null | undefined;
interface XmlNode {
  [key: string]: XmlValue;
}

function asArray(value: XmlValue): XmlValue[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asNode(value: XmlValue): XmlNode | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
}

function textOf(value: XmlValue): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const node = asNode(value);
  if (node && '#text' in node) return textOf(node['#text']);
  return '';
}

function atomLink(value: XmlValue): string | null {
  for (const entry of asArray(value)) {
    const node = asNode(entry);
    const href = node?.['@_href'];
    const rel = node?.['@_rel'];
    if (typeof href === 'string' && (rel === undefined || rel === 'alternate')) return href;
  }
  return null;
}

function parseDate(value: XmlValue): Date | null {
  const text = textOf(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseFeed(xml: string, url: string, maxItems: number): FetchedFeed {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new SourceFetchError('UNSUPPORTED', 'El feed declara DOCTYPE o entidades');
  }
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const document = asNode(parser.parse(xml) as XmlValue);
  const channel = asNode(asNode(document?.rss)?.channel);
  const feed = asNode(document?.feed);
  const summary = (value: XmlValue) => htmlToText(textOf(value)).slice(0, 1000);
  const safeUrl = (value: string | null) => {
    if (!value) return null;
    try {
      const parsed = new URL(value, url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
    } catch {
      return null;
    }
  };

  if (channel) {
    return {
      url,
      title: textOf(channel.title),
      items: asArray(channel.item)
        .slice(0, maxItems)
        .flatMap((entry) => {
          const item = asNode(entry);
          if (!item) return [];
          return [
            {
              title: textOf(item.title),
              url: safeUrl(textOf(item.link) || null),
              summary: summary(item.description ?? item['content:encoded']),
              publishedAt: parseDate(item.pubDate),
            },
          ];
        }),
    };
  }
  if (feed) {
    return {
      url,
      title: textOf(feed.title),
      items: asArray(feed.entry)
        .slice(0, maxItems)
        .flatMap((entry) => {
          const item = asNode(entry);
          if (!item) return [];
          return [
            {
              title: textOf(item.title),
              url: safeUrl(atomLink(item.link)),
              summary: summary(item.summary ?? item.content),
              publishedAt: parseDate(item.updated ?? item.published),
            },
          ];
        }),
    };
  }
  throw new SourceFetchError('UNSUPPORTED', 'No es un feed RSS ni Atom');
}

export class HttpSourceFetcher implements SourceFetcher {
  constructor(private readonly fetcher: typeof safeFetch = safeFetch) {}

  async fetchPage(url: string): Promise<FetchedPage> {
    const response = await this.get(url, PAGE_TYPES);
    const body = response.body.toString('utf8');
    if (!response.contentType.startsWith('text/html') && !response.contentType.includes('xhtml')) {
      return { url: response.url, title: '', text: body.trim(), links: [] };
    }
    return { url: response.url, ...parsePage(body, response.url) };
  }

  async fetchFeed(url: string, maxItems: number): Promise<FetchedFeed> {
    const response = await this.get(url, FEED_TYPES);
    return parseFeed(response.body.toString('utf8'), response.url, maxItems);
  }

  private async get(url: string, accept: readonly string[]) {
    const options: SafeFetchOptions = {
      accept,
      timeoutMs: 10_000,
      maxBytes: 2 * 1024 * 1024,
      ports: [80, 443],
      allowPrivate: false,
      headers: { accept: `${accept.join(', ')};q=0.9, */*;q=0.1` },
    };
    try {
      const response = await this.fetcher(url, options);
      if (response.status >= 400) {
        throw new SourceFetchError('UNAVAILABLE', `La fuente respondió ${response.status}`);
      }
      return response;
    } catch (error) {
      if (error instanceof SafeFetchError) {
        const code =
          error.code === 'BLOCKED'
            ? 'BLOCKED'
            : error.code === 'TOO_LARGE'
              ? 'TOO_LARGE'
              : error.code === 'UNSUPPORTED'
                ? 'UNSUPPORTED'
                : 'UNAVAILABLE';
        throw new SourceFetchError(code, error.message);
      }
      throw error;
    }
  }
}
