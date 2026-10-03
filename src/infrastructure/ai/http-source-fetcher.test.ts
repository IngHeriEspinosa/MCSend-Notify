import { describe, expect, it } from 'vitest';
import { LinkPolicy, sanitizeMarkdownLinks } from '@/core/ai/guardrails';
import { htmlToText, parseFeed, parsePage } from './http-source-fetcher';
import { LinkifyLinkFinder } from './linkify-link-finder';

describe('páginas HTML', () => {
  it('extrae el contenido principal sin navegación, scripts ni estilos', () => {
    const page = parsePage(
      `<html><head><title>Novedades &amp; más</title><style>p{}</style></head><body>
        <nav><a href="/login">Entrar</a></nav>
        <main><h1>MCSupport 3.2</h1><p>Panel de <b>SLA</b>.</p><ul><li>Uno</li><li>Dos</li></ul>
        <a href="/guia#sla">Guía</a><a href="javascript:alert(1)">x</a><script>alert(1)</script></main>
        <footer>© 2026</footer></body></html>`,
      'https://multicomputos.com/blog/',
    );
    expect(page.title).toBe('Novedades & más');
    expect(page.text).toContain('MCSupport 3.2\nPanel de SLA.');
    expect(page.text).toContain('- Uno\n- Dos');
    expect(page.text).not.toMatch(/alert|Entrar|©/);
    expect(page.links).toEqual(['https://multicomputos.com/guia']);
  });

  it('decodifica entidades numéricas', () => {
    expect(htmlToText('<p>Caf&#233; &#x2014; listo&nbsp;ya</p>')).toBe('Café — listo ya');
  });
});

describe('feeds', () => {
  it('lee RSS 2.0 y Atom', () => {
    const rss = parseFeed(
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>
        <item><title>API nueva</title><link>https://multicomputos.com/api</link>
        <description>&lt;p&gt;Ya disponible&lt;/p&gt;</description><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item>
        <item><title>Otra</title><link>javascript:alert(1)</link><description>x</description></item>
      </channel></rss>`,
      'https://multicomputos.com/rss',
      5,
    );
    expect(rss.title).toBe('Blog');
    expect(rss.items[0]).toMatchObject({
      title: 'API nueva',
      url: 'https://multicomputos.com/api',
      summary: 'Ya disponible',
    });
    expect(rss.items[1]?.url).toBeNull();

    const atom = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Changelog</title>
        <entry><title>3.2</title><link rel="alternate" href="/v/3-2"/><summary>SLA</summary><updated>2026-09-30T00:00:00Z</updated></entry></feed>`,
      'https://multicomputos.com/atom',
      5,
    );
    expect(atom.items[0]).toMatchObject({ title: '3.2', url: 'https://multicomputos.com/v/3-2' });
  });

  it('rechaza XML con DOCTYPE o entidades (XXE, billion laughs)', () => {
    expect(() =>
      parseFeed(
        '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><rss><channel></channel></rss>',
        'https://x.example/rss',
        5,
      ),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED' }));
  });
});

describe('LinkifyLinkFinder', () => {
  it('detecta exactamente los enlaces que el renderizado del correo convierte en <a>', () => {
    const finder = new LinkifyLinkFinder();
    const result = sanitizeMarkdownLinks(
      'Entra en https://evil.example/login, www.evil.com o https://ok.example/a.',
      new LinkPolicy(['https://ok.example/a']),
      finder,
    );
    // Los dominios sin esquema no se enlazan en el correo (linkify sin "fuzzy"): quedan como texto.
    expect(result.text).toBe('Entra en , www.evil.com o https://ok.example/a.');
    expect(result.removed).toEqual(['https://evil.example/login']);
  });
});
