import { beforeEach, describe, expect, it } from 'vitest';
import { FakeSourceFetcher, InMemoryChangelogRepository } from '@tests/fakes/ai.fakes';
import { InMemoryDocumentRepository } from '@tests/fakes/content.fakes';
import { FakeClock } from '@tests/fakes/identity.fakes';
import { ownerContext } from '@tests/fakes/sending.fakes';
import { ContentCollector, MAX_SOURCE_CHARS, SourceFetchError } from './sources';

let fetcher: FakeSourceFetcher;
let changelog: InMemoryChangelogRepository;
let clock: FakeClock;

const collector = () =>
  new ContentCollector({
    fetcher,
    documents: new InMemoryDocumentRepository(),
    changelog,
    clock,
  });

beforeEach(() => {
  fetcher = new FakeSourceFetcher();
  changelog = new InMemoryChangelogRepository();
  clock = new FakeClock();
});

describe('ContentCollector', () => {
  it('reúne texto, páginas y feeds con las URL que se pueden citar', async () => {
    fetcher.pages.set('https://multicomputos.com/blog', {
      url: 'https://multicomputos.com/blog',
      title: 'Blog',
      text: 'Artículo sobre SLA',
      links: ['https://multicomputos.com/blog/sla'],
    });
    fetcher.feeds.set('https://multicomputos.com/rss', {
      url: 'https://multicomputos.com/rss',
      title: 'Feed',
      items: [
        {
          title: 'Nueva API',
          url: 'https://multicomputos.com/api',
          summary: 'x',
          publishedAt: null,
        },
      ],
    });
    const { sources } = await collector().collect(ownerContext, [
      { kind: 'text', title: 'Notas', text: 'Ver https://docs.example.com/x' },
      { kind: 'url', url: 'https://multicomputos.com/blog' },
      { kind: 'rss', url: 'https://multicomputos.com/rss', maxItems: 5 },
    ]);
    expect(sources.map((source) => source.id)).toEqual(['s1', 's2', 's3']);
    expect(sources[0]?.urls).toEqual(['https://docs.example.com/x']);
    expect(sources[1]?.urls).toContain('https://multicomputos.com/blog/sla');
    expect(sources[2]?.urls).toEqual(['https://multicomputos.com/api']);
  });

  it('traduce una URL bloqueada (SSRF) a un error de validación con el índice de la fuente', async () => {
    fetcher.pages.set(
      'http://169.254.169.254/latest',
      new SourceFetchError('BLOCKED', 'bloqueada'),
    );
    await expect(
      collector().collect(ownerContext, [{ kind: 'url', url: 'http://169.254.169.254/latest' }]),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'SOURCE_BLOCKED', source: 0 },
    });
  });

  it('incluye solo las novedades nuevas del periodo y omite la fuente si no hay', async () => {
    changelog.add({
      title: 'Panel SLA',
      publishedAt: new Date('2026-09-30T10:00:00Z'),
      version: '3.2',
    });
    changelog.add({ title: 'Antigua', publishedAt: new Date('2026-08-01T10:00:00Z') });
    const consumed = changelog.add({
      title: 'Ya enviada',
      publishedAt: new Date('2026-10-01T10:00:00Z'),
    });
    consumed.consumedByRunId = 'run-0';

    const result = await collector().collect(ownerContext, [
      { kind: 'changelog', days: 7, onlyNew: true },
    ]);
    expect(result.sources[0]?.text).toContain('Panel SLA');
    expect(result.sources[0]?.text).not.toMatch(/Antigua|Ya enviada/);
    expect(result.changelogIds).toHaveLength(1);

    changelog.entries.splice(0);
    const empty = await collector().collect(ownerContext, [
      { kind: 'changelog', days: 7, onlyNew: true },
    ]);
    expect(empty.sources).toEqual([]);
  });

  it('recorta cada fuente al máximo de caracteres', async () => {
    const { sources } = await collector().collect(ownerContext, [
      { kind: 'text', title: '', text: 'a'.repeat(MAX_SOURCE_CHARS) },
    ]);
    expect(sources[0]?.text.length).toBeLessThanOrEqual(MAX_SOURCE_CHARS + 1);
  });
});
