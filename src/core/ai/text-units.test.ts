import { describe, expect, it } from 'vitest';
import { regexLinkFinder } from '@tests/fakes/ai.fakes';
import type { TemplateBody } from '@/core/templates/email-content';
import { applyTextUnits, extractTextUnits } from './text-units';

const body: TemplateBody = {
  format: 'BLOCKS',
  subject: 'Hola {{ contact.first_name }}',
  preheader: 'Novedades de octubre',
  locale: 'es',
  content: {
    blocks: [
      { id: 'h1', type: 'heading', text: 'Novedades', level: 1, align: 'left' },
      {
        id: 't1',
        type: 'text',
        markdown: 'Lee [la guía](https://docs.example.com/guia) completa.',
      },
      {
        id: 'b1',
        type: 'button',
        label: 'Ver más',
        url: 'https://multicomputos.com',
        align: 'center',
      },
      { id: 'd1', type: 'divider' },
    ],
  },
};

describe('unidades de texto', () => {
  it('extrae solo textos, nunca URL ni estructura', () => {
    const units = extractTextUnits(body);
    expect(units.map((unit) => unit.id)).toEqual([
      'subject',
      'preheader',
      'b0.text',
      'b1.markdown',
      'b2.label',
    ]);
    expect(units.some((unit) => unit.text.includes('multicomputos.com'))).toBe(false);
  });

  it('aplica textos válidos y conserva el original de los que no superan la validación', () => {
    const result = applyTextUnits(
      body,
      new Map([
        ['subject', 'Hi there'], // pierde la variable Liquid → se rechaza
        ['preheader', 'October news'],
        ['b0.text', 'News'],
        [
          'b1.markdown',
          'Read [the guide](https://docs.example.com/guia) and [win](https://evil.example).',
        ],
        ['b2.label', 'x'.repeat(200)], // supera la longitud máxima → se rechaza
      ]),
      regexLinkFinder,
      { locale: 'en' },
    );
    expect(result.rejected).toEqual(['subject', 'b2.label']);
    expect(result.removedLinks).toEqual(['https://evil.example']);
    expect(result.body.subject).toBe('Hola {{ contact.first_name }}');
    expect(result.body.locale).toBe('en');
    expect(result.body.format === 'BLOCKS' && result.body.content.blocks[1]).toMatchObject({
      markdown: 'Read [the guide](https://docs.example.com/guia) and win.',
    });
    expect(result.body.format === 'BLOCKS' && result.body.content.blocks[2]).toMatchObject({
      url: 'https://multicomputos.com',
    });
  });

  it('no reescribe plantillas HTML', () => {
    expect(() =>
      extractTextUnits({
        format: 'HTML',
        subject: 'x',
        preheader: null,
        locale: 'es',
        content: { html: '<p>x</p>' },
      }),
    ).toThrow(expect.objectContaining({ details: { reason: 'AI_UNSUPPORTED_FORMAT' } }));
  });
});
