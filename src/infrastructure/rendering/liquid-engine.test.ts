import { describe, expect, it } from 'vitest';
import { LiquidEngine, LiquidProtector } from './liquid-engine';

const engine = new LiquidEngine();

describe('LiquidEngine (modo restringido)', () => {
  it('escapa la salida en HTML y no en texto plano', async () => {
    const variables = { contact: { first_name: '<script>alert(1)</script>' } };
    await expect(engine.render('Hola {{ contact.first_name }}', variables, 'html')).resolves.toBe(
      'Hola &lt;script&gt;alert(1)&lt;/script&gt;',
    );
    await expect(engine.render('Hola {{ contact.first_name }}', variables, 'text')).resolves.toBe(
      'Hola <script>alert(1)</script>',
    );
  });

  it('el filtro raw no existe: no se puede desactivar el escape', async () => {
    await expect(
      engine.render('{{ contact.first_name | raw }}', { contact: { first_name: '<b>' } }, 'html'),
    ).rejects.toThrow(/raw/);
    expect(engine.analyze('{{ x | raw }}').ok).toBe(false);
  });

  it('no permite leer archivos del servidor con include o render', async () => {
    await expect(engine.render("{% include 'package.json' %}", {}, 'text')).rejects.toThrow();
    await expect(engine.render("{% render '../.env' %}", {}, 'text')).rejects.toThrow();
  });

  it('no expone propiedades heredadas (prototipo)', async () => {
    await expect(
      engine.render('{{ contact.constructor }}{{ contact.__proto__ }}', { contact: {} }, 'text'),
    ).resolves.toBe('');
  });

  it('limita el tiempo de render (bucles abusivos)', async () => {
    const abusive = '{% for i in (1..100000000) %}{{ i }}{% endfor %}';
    await expect(engine.render(abusive, {}, 'text')).rejects.toThrow();
  }, 10_000);

  it('analiza variables globales con su ruta e ignora las locales', () => {
    const analysis = engine.analyze(
      '{{ contact.first_name }} {% for item in fields.list %}{{ item }}{% endfor %} {{ current_year }}',
    );
    expect(analysis).toEqual({
      ok: true,
      variables: expect.arrayContaining(['contact.first_name', 'fields.list', 'current_year']),
    });
    expect(analysis.ok && analysis.variables).not.toContain('item');
  });

  it('informa los errores de sintaxis', () => {
    const analysis = engine.analyze('{{ contact.first_name ');
    expect(analysis.ok).toBe(false);
  });
});

describe('LiquidProtector', () => {
  it('sustituye las etiquetas por marcadores y las restaura intactas', () => {
    const protector = new LiquidProtector();
    const source = 'Hola {{ contact.first_name | default: "cliente" }} {% if x %}sí{% endif %}';
    const protectedText = protector.protect(source);
    expect(protectedText).not.toContain('{');
    expect(protectedText).not.toContain('"');
    expect(protector.restore(protectedText)).toBe(source);
  });

  it('tagAt solo reconoce un marcador completo', () => {
    const protector = new LiquidProtector();
    const marker = protector.protect('{{ unsubscribe_url }}');
    expect(protector.tagAt(marker)).toBe('{{ unsubscribe_url }}');
    expect(protector.tagAt(`https://x.com/${marker}`)).toBeNull();
  });
});
