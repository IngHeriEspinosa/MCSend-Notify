import { describe, expect, it } from 'vitest';
import type { EmailBlock, TemplateBody } from '@/core/templates/email-content';
import type { DocumentAsset, PrepareEmailInput } from '@/core/templates/ports';
import { buildRecipientVariables, SAMPLE_RECIPIENT } from '@/core/templates/template-variables';
import { HtmlEmailCompiler } from './email-compiler';

const DOCUMENT_ID = '0199a8f0-0000-7000-8000-000000000001';

const readyDeck: DocumentAsset = {
  id: DOCUMENT_ID,
  title: 'MCSupport 3.2',
  kind: 'PRESENTATION',
  status: 'READY',
  pageCount: 4,
  sizeBytes: 16_155,
  thumbnailUrl: 'https://app.test/trk/i/thumb',
  thumbnailWidth: 1200,
  thumbnailHeight: 675,
  downloadUrl: 'https://app.test/trk/d/file',
};

function input(body: TemplateBody, overrides: Partial<PrepareEmailInput> = {}): PrepareEmailInput {
  return {
    body,
    sender: {
      tenantName: 'MCSupport',
      postalAddress: 'Av. Abraham Lincoln 1007, Santo Domingo',
      branding: { primary: '#005E7D', accent: '#EBAD39', logoKey: null, footerMd: null },
      logoUrl: null,
    },
    documents: new Map([[DOCUMENT_ID, readyDeck]]),
    fieldKeys: new Set(['plan']),
    ...overrides,
  };
}

const blocks = (content: EmailBlock[]): TemplateBody => ({
  format: 'BLOCKS',
  subject: 'Novedades para {{ contact.first_name }}',
  preheader: 'Lo nuevo de este mes',
  locale: 'es',
  content: { blocks: content },
});

const variables = (firstName: string) =>
  buildRecipientVariables({
    recipient: { ...SAMPLE_RECIPIENT, firstName, attributes: { plan: 'Pro & "Max"' } },
    tenantName: 'MCSupport',
    links: { unsubscribeUrl: 'https://app.test/u/1', preferencesUrl: 'https://app.test/p/1' },
    now: new Date('2026-10-02T12:00:00Z'),
  });

const compiler = new HtmlEmailCompiler();

describe('HtmlEmailCompiler', () => {
  it('compila bloques con tarjeta de documento (miniatura enlazada) y pie obligatorio', async () => {
    const prepared = await compiler.prepare(
      input(
        blocks([
          {
            id: 'h',
            type: 'heading',
            text: 'Hola {{ contact.first_name }}',
            level: 1,
            align: 'left',
          },
          {
            id: 'd',
            type: 'document',
            documentId: DOCUMENT_ID,
            title: null,
            description: null,
            buttonLabel: null,
          },
        ]),
      ),
    );
    const email = await compiler.personalize(prepared, variables('Ana'));

    expect(email.subject).toBe('Novedades para Ana');
    expect(email.html).toContain('Hola Ana');
    expect(email.html).toContain('src="https://app.test/trk/i/thumb"');
    expect(email.html).toContain('alt="Vista previa de MCSupport 3.2"');
    expect(email.html).toContain('Presentación · 4 diapositivas');
    expect(email.html).toContain('Ver presentación');
    expect(email.html).toContain('href="https://app.test/u/1"');
    expect(email.html).toContain('Av. Abraham Lincoln 1007');
    expect(email.text).toContain('Ver presentación: https://app.test/trk/d/file');
    expect(email.text).toContain('Darse de baja: https://app.test/u/1');
    expect(prepared.issues).toEqual([]);
  });

  it('escapa los datos del contacto en el HTML (XSS por datos importados)', async () => {
    const prepared = await compiler.prepare(
      input(
        blocks([
          {
            id: 't',
            type: 'text',
            markdown: 'Hola {{ contact.first_name }}, plan {{ fields.plan }}',
          },
        ]),
      ),
    );
    const email = await compiler.personalize(prepared, variables('<img src=x onerror=alert(1)>'));

    expect(email.html).not.toMatch(/<img src=x/);
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('Pro &amp; &#34;Max&#34;');
  });

  it('el Markdown no admite HTML ni enlaces javascript:', async () => {
    const prepared = await compiler.prepare(
      input({
        format: 'MARKDOWN',
        subject: 'x',
        preheader: 'y',
        locale: 'es',
        content: {
          markdown:
            '<script>alert(1)</script>\n\n[clic](javascript:alert(1)) [baja]({{ unsubscribe_url }})',
        },
      }),
    );
    const email = await compiler.personalize(prepared, variables('Ana'));
    expect(email.html).not.toMatch(/<script/i);
    expect(email.html).not.toMatch(/href="javascript:/i);
    expect(email.html).toContain('href="https://app.test/u/1"');
  });

  it('el asunto personalizado nunca contiene saltos de línea (inyección de cabeceras)', async () => {
    const prepared = await compiler.prepare(input(blocks([])));
    const email = await compiler.personalize(
      prepared,
      variables('Ana\r\nBcc: victima@example.com'),
    );
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it('detecta incidencias: dirección, documento, variable, asunto largo, contenido vacío', async () => {
    const prepared = await compiler.prepare(
      input(
        {
          ...blocks([
            { id: 't', type: 'text', markdown: '{{ contact.inexistente }}' },
            {
              id: 'd',
              type: 'document',
              documentId: '0199a8f0-0000-7000-8000-000000000002',
              title: null,
              description: null,
              buttonLabel: null,
            },
          ]),
          subject: 'A'.repeat(90),
          preheader: null,
        },
        {
          sender: {
            tenantName: 'MCSupport',
            postalAddress: null,
            branding: { primary: '#005E7D', accent: '#005E7D', logoKey: null, footerMd: null },
            logoUrl: null,
          },
        },
      ),
    );
    const codes = prepared.issues.map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'POSTAL_ADDRESS_MISSING',
        'DOCUMENT_UNAVAILABLE',
        'UNKNOWN_VARIABLE',
        'SUBJECT_TOO_LONG',
        'PREHEADER_MISSING',
      ]),
    );
    expect(prepared.issues[0]?.severity).toBe('error');
    expect((await compiler.prepare(input(blocks([])))).issues.map((issue) => issue.code)).toContain(
      'EMPTY_CONTENT',
    );
  });

  it('avisa si el HTML supera el límite de recorte de Gmail', async () => {
    const prepared = await compiler.prepare(
      input(
        blocks([
          { id: 't', type: 'text', markdown: 'Texto largo. '.repeat(10_000).slice(0, 20_000) },
          { id: 't2', type: 'text', markdown: 'Más texto. '.repeat(10_000).slice(0, 20_000) },
          { id: 't3', type: 'text', markdown: 'Otro. '.repeat(10_000).slice(0, 20_000) },
          { id: 't4', type: 'text', markdown: 'Fin. '.repeat(10_000).slice(0, 20_000) },
          { id: 't5', type: 'text', markdown: 'Extra. '.repeat(10_000).slice(0, 20_000) },
        ]),
      ),
    );
    expect(prepared.issues.map((issue) => issue.code)).toContain('HTML_TOO_LARGE');
  });

  it('el HTML propio se sanea y se marca la incidencia', async () => {
    const prepared = await compiler.prepare(
      input({
        format: 'HTML',
        subject: 'x',
        preheader: 'y',
        locale: 'en',
        content: { html: '<p onclick="steal()">Hi {{ contact.first_name }}</p><script>x</script>' },
      }),
    );
    const email = await compiler.personalize(prepared, variables('Ana'));
    expect(email.html).toContain('Hi Ana');
    expect(email.html).not.toMatch(/onclick|<script/i);
    expect(email.html).toContain('Unsubscribe');
    expect(prepared.issues.map((issue) => issue.code)).toContain('CONTENT_SANITIZED');
  });

  it('la vista previa oscura aplica la paleta oscura sin media query', async () => {
    const dark = await compiler.prepare(input(blocks([]), { forceColorScheme: 'dark' }));
    const auto = await compiler.prepare(input(blocks([])));
    expect(dark.html).toContain('#121212');
    expect(dark.html).not.toContain('prefers-color-scheme');
    expect(auto.html).toContain('@media (prefers-color-scheme: dark)');
  });

  it('una plantilla con error de sintaxis Liquid se informa al preparar y falla con VALIDATION al personalizar', async () => {
    const prepared = await compiler.prepare(
      input(blocks([{ id: 't', type: 'text', markdown: 'Hola {{ contact.first_name ' }])),
    );
    expect(prepared.issues.map((issue) => issue.code)).toContain('LIQUID_SYNTAX');
    await expect(compiler.personalize(prepared, variables('Ana'))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'TEMPLATE_RENDER' },
    });
  });
});
