/**
 * Fuentes de contenido para redactar con IA: texto pegado, páginas web, feeds RSS, documentos de
 * la biblioteca y novedades del buzón de changelog.
 *
 * El recolector resuelve cada fuente a texto plano con límites de tamaño. Las páginas y feeds se
 * descargan con protección SSRF (solo hosts públicos) desde la infraestructura.
 */
import { z } from 'zod';
import type { ChangelogEntryView, ChangelogRepository } from '@/core/changelog/changelog';
import type { DocumentRepository } from '@/core/documents/ports';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { extractUrls } from './guardrails';

export const MAX_SOURCES = 10;
export const MAX_SOURCE_CHARS = 20_000;
export const MAX_TOTAL_SOURCE_CHARS = 60_000;
const MAX_CHANGELOG_ENTRIES = 50;

const httpUrl = z.url({ protocol: /^https?$/ }).max(2000);

export const draftSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    title: z.string().trim().max(120).default(''),
    text: z.string().trim().min(1).max(MAX_SOURCE_CHARS),
  }),
  z.object({ kind: z.literal('url'), url: httpUrl }),
  z.object({
    kind: z.literal('rss'),
    url: httpUrl,
    maxItems: z.number().int().min(1).max(20).default(5),
  }),
  z.object({ kind: z.literal('document'), documentId: z.uuid() }),
  z.object({
    kind: z.literal('changelog'),
    /** Novedades publicadas en los últimos N días. */
    days: z.number().int().min(1).max(90).default(7),
    /** Solo las que ninguna automatización envió todavía. */
    onlyNew: z.boolean().default(true),
  }),
]);

export type DraftSource = z.infer<typeof draftSourceSchema>;
export type DraftSourceKind = DraftSource['kind'];

export interface CollectedSource {
  /** Identificador corto para el prompt (`s1`, `s2`...). */
  id: string;
  kind: DraftSourceKind;
  title: string;
  text: string;
  /**
   * URL citables: las únicas que la salida puede enlazar. Salen de datos estructurados o de
   * confianza (texto del editor, enlaces reales de páginas y feeds, novedades publicadas por la
   * aplicación), nunca del texto libre de una página descargada.
   */
  urls: string[];
  /** Documento citable con una tarjeta de documento. */
  documentId?: string;
  /** Novedades incluidas (para marcarlas como enviadas). */
  changelogIds?: string[];
}

/** Resumen sin contenido para el historial de ejecuciones. */
export interface SourceSummary {
  kind: DraftSourceKind;
  title: string;
  chars: number;
}

export interface FetchedPage {
  /** URL final (tras redirecciones). */
  url: string;
  title: string;
  text: string;
  /** Enlaces absolutos http(s) del contenido principal: citables en el correo. */
  links: string[];
}

export interface FetchedFeed {
  url: string;
  title: string;
  items: Array<{ title: string; url: string | null; summary: string; publishedAt: Date | null }>;
}

export const SOURCE_FETCH_ERROR_CODES = [
  'BLOCKED',
  'UNAVAILABLE',
  'UNSUPPORTED',
  'TOO_LARGE',
] as const;
export type SourceFetchErrorCode = (typeof SOURCE_FETCH_ERROR_CODES)[number];

const SOURCE_FETCH_ERROR_BRAND = Symbol.for('mc-send-notify.SourceFetchError');

export class SourceFetchError extends Error {
  readonly [SOURCE_FETCH_ERROR_BRAND] = true;

  constructor(
    readonly code: SourceFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SourceFetchError';
  }
}

export function isSourceFetchError(error: unknown): error is SourceFetchError {
  if (error instanceof SourceFetchError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    SOURCE_FETCH_ERROR_BRAND in error &&
    error[SOURCE_FETCH_ERROR_BRAND] === true
  );
}

/** Descarga de páginas y feeds públicos (infraestructura con protección SSRF). */
export interface SourceFetcher {
  fetchPage(url: string): Promise<FetchedPage>;
  fetchFeed(url: string, maxItems: number): Promise<FetchedFeed>;
}

export interface ContentCollectorDeps {
  fetcher: SourceFetcher;
  documents: Pick<DocumentRepository, 'findById'>;
  changelog: Pick<ChangelogRepository, 'findForSources'>;
  clock: Clock;
}

export interface CollectedContent {
  sources: CollectedSource[];
  changelogIds: string[];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatChangelog(entries: readonly ChangelogEntryView[]): string {
  return entries
    .map((entry) => {
      const date = entry.publishedAt.toISOString().slice(0, 10);
      const version = entry.version ? ` ${entry.version}` : '';
      const body = entry.bodyMd ? `\n${entry.bodyMd}` : '';
      return `- [${entry.category}${version} · ${date}] ${entry.title}${body}`;
    })
    .join('\n');
}

export class ContentCollector {
  constructor(private readonly deps: ContentCollectorDeps) {}

  async collect(
    context: TenantContext,
    sources: readonly DraftSource[],
  ): Promise<CollectedContent> {
    if (sources.length === 0 || sources.length > MAX_SOURCES) {
      throw new DomainError('VALIDATION', 'Número de fuentes inválido', {
        reason: 'SOURCES_COUNT',
      });
    }
    const collected: CollectedSource[] = [];
    const changelogIds: string[] = [];
    let budget = MAX_TOTAL_SOURCE_CHARS;

    for (const [index, source] of sources.entries()) {
      const id = `s${index + 1}`;
      const resolved = await this.resolve(context, id, source, index);
      if (!resolved) continue;
      const text = truncate(resolved.text, Math.min(MAX_SOURCE_CHARS, budget));
      budget -= text.length;
      collected.push({ ...resolved, text });
      changelogIds.push(...(resolved.changelogIds ?? []));
      if (budget <= 0) break;
    }
    return { sources: collected, changelogIds };
  }

  private async resolve(
    context: TenantContext,
    id: string,
    source: DraftSource,
    index: number,
  ): Promise<CollectedSource | null> {
    switch (source.kind) {
      case 'text':
        return {
          id,
          kind: 'text',
          title: source.title,
          text: source.text,
          urls: extractUrls(source.text),
        };
      case 'url': {
        const page = await this.fetch(index, () => this.deps.fetcher.fetchPage(source.url));
        return {
          id,
          kind: 'url',
          title: page.title || page.url,
          text: page.text,
          // El texto de una página es contenido no confiable: una URL escrita en él (p. ej. en una
          // inyección) no es citable. Solo lo son la propia página y sus enlaces reales (href).
          urls: [page.url, ...page.links],
        };
      }
      case 'rss': {
        const feed = await this.fetch(index, () =>
          this.deps.fetcher.fetchFeed(source.url, source.maxItems),
        );
        const text = feed.items
          .map((item) => `- ${item.title}${item.url ? ` (${item.url})` : ''}\n  ${item.summary}`)
          .join('\n');
        return {
          id,
          kind: 'rss',
          title: feed.title || feed.url,
          text,
          urls: feed.items.flatMap((item) => (item.url ? [item.url] : [])),
        };
      }
      case 'document': {
        const document = await this.deps.documents.findById(context, source.documentId);
        if (!document || document.status !== 'READY') {
          throw new DomainError('VALIDATION', 'Documento no disponible', {
            reason: 'SOURCE_DOCUMENT',
            source: index,
          });
        }
        return {
          id,
          kind: 'document',
          title: document.title,
          text: document.extractedText ?? '',
          urls: [],
          documentId: document.id,
        };
      }
      case 'changelog': {
        const since = new Date(this.deps.clock.now().getTime() - source.days * 86_400_000);
        const entries = await this.deps.changelog.findForSources(
          context,
          since,
          source.onlyNew,
          MAX_CHANGELOG_ENTRIES,
        );
        if (entries.length === 0) return null;
        const text = formatChangelog(entries);
        return {
          id,
          kind: 'changelog',
          title: 'Changelog',
          text,
          urls: extractUrls(text),
          changelogIds: entries.map((entry) => entry.id),
        };
      }
    }
  }

  private async fetch<T>(index: number, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isSourceFetchError(error)) {
        throw new DomainError('VALIDATION', error.message, {
          reason: error.code === 'BLOCKED' ? 'SOURCE_BLOCKED' : 'SOURCE_UNAVAILABLE',
          source: index,
        });
      }
      throw error;
    }
  }
}

export function summarizeSources(sources: readonly CollectedSource[]): SourceSummary[] {
  return sources.map((source) => ({
    kind: source.kind,
    title: source.title.slice(0, 120),
    chars: source.text.length,
  }));
}
