import { describe, expect, it } from 'vitest';
import {
  emailBlockSchema,
  isAllowedLinkUrl,
  referencedDocumentIds,
  templateBodySchema,
} from './email-content';

describe('isAllowedLinkUrl', () => {
  it.each([
    'https://multicomputos.com',
    'http://intranet.example/x',
    'mailto:soporte@multicomputos.com',
    '{{ unsubscribe_url }}',
    '{{preferences_url}}',
  ])('acepta %s', (url) => expect(isAllowedLinkUrl(url)).toBe(true));

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>',
    '{{ contact.website }}',
    '{{ unsubscribe_url }}x',
    '//evil.example',
    'ftp://files.example',
    '/relativa',
  ])('rechaza %s', (url) => expect(isAllowedLinkUrl(url)).toBe(false));
});

describe('bloques', () => {
  it('una imagen exige texto alternativo y exactamente un origen https o de la biblioteca', () => {
    const base = { id: 'i1', type: 'image', alt: 'Banner' };
    expect(emailBlockSchema.safeParse({ ...base, src: 'https://cdn.example/a.png' }).success).toBe(
      true,
    );
    expect(emailBlockSchema.safeParse({ ...base, src: 'http://cdn.example/a.png' }).success).toBe(
      false,
    );
    expect(
      emailBlockSchema.safeParse({ ...base, alt: '', src: 'https://a.example/x.png' }).success,
    ).toBe(false);
    expect(emailBlockSchema.safeParse({ ...base }).success).toBe(false);
    expect(
      emailBlockSchema.safeParse({
        ...base,
        src: 'https://a.example/x.png',
        documentId: '0199a8f0-0000-7000-8000-000000000001',
      }).success,
    ).toBe(false);
  });

  it('un botón no admite variables de contacto en el enlace', () => {
    const button = { id: 'b1', type: 'button', label: 'Ver' };
    expect(emailBlockSchema.safeParse({ ...button, url: '{{ contact.website }}' }).success).toBe(
      false,
    );
    expect(emailBlockSchema.safeParse({ ...button, url: '{{ unsubscribe_url }}' }).success).toBe(
      true,
    );
  });

  it('las columnas no se anidan', () => {
    const nested = {
      id: 'c1',
      type: 'columns',
      left: [{ id: 'c2', type: 'columns', left: [], right: [] }],
      right: [],
    };
    expect(emailBlockSchema.safeParse(nested).success).toBe(false);
  });
});

describe('templateBodySchema y referencedDocumentIds', () => {
  it('extrae los documentos referenciados, incluidas las columnas', () => {
    const body = templateBodySchema.parse({
      format: 'BLOCKS',
      subject: 'Hola',
      preheader: '',
      locale: 'es',
      content: {
        blocks: [
          { id: 'd1', type: 'document', documentId: '0199a8f0-0000-7000-8000-000000000001' },
          {
            id: 'c1',
            type: 'columns',
            left: [
              {
                id: 'i1',
                type: 'image',
                alt: 'x',
                documentId: '0199a8f0-0000-7000-8000-000000000002',
              },
            ],
            right: [],
          },
        ],
      },
    });
    expect(body.preheader).toBeNull();
    expect(referencedDocumentIds(body)).toEqual([
      '0199a8f0-0000-7000-8000-000000000001',
      '0199a8f0-0000-7000-8000-000000000002',
    ]);
  });

  it('el contenido debe corresponder al formato', () => {
    expect(
      templateBodySchema.safeParse({
        format: 'MARKDOWN',
        subject: 'x',
        preheader: null,
        locale: 'es',
        content: { html: '<p>x</p>' },
      }).success,
    ).toBe(false);
  });
});
