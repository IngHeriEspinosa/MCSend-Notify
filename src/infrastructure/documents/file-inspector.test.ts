import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MagicBytesFileInspector } from './file-inspector';

const inspector = new MagicBytesFileInspector();
const text = (value: string) => new TextEncoder().encode(value);
const bytes = (...values: number[]) => {
  const buffer = new Uint8Array(512);
  buffer.set(values);
  return buffer;
};

describe('MagicBytesFileInspector', () => {
  it('identifica PDF e imágenes por su firma', async () => {
    await expect(
      inspector.inspect('informe.pdf', text('%PDF-1.7\n%âãÏÓ\n1 0 obj')),
    ).resolves.toMatchObject({
      kind: 'PDF',
      extension: 'pdf',
    });
    await expect(
      inspector.inspect(
        'foto.png',
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52),
      ),
    ).resolves.toMatchObject({ kind: 'IMAGE', mimeType: 'image/png' });
  });

  it('usa el contenido real aunque la extensión mienta', async () => {
    await expect(inspector.inspect('presentacion.pptx', text('%PDF-1.4\n'))).resolves.toMatchObject(
      {
        kind: 'PDF',
        extension: 'pdf',
      },
    );
  });

  it('identifica una presentación PPTX real', async () => {
    const deck = new Uint8Array(readFileSync('prisma/seed-assets/sample-deck.pptx'));
    await expect(inspector.inspect('deck.pptx', deck)).resolves.toMatchObject({
      kind: 'PRESENTATION',
      extension: 'pptx',
    });
  });

  it('acepta formatos de texto UTF-8 por extensión', async () => {
    await expect(inspector.inspect('notas.md', text('# Título\n\nTexto'))).resolves.toMatchObject({
      kind: 'MARKDOWN',
    });
    await expect(inspector.inspect('pagina.htm', text('<p>Hola</p>'))).resolves.toMatchObject({
      kind: 'HTML',
      extension: 'html',
    });
    await expect(inspector.inspect('leeme.txt', text('hola'))).resolves.toMatchObject({
      kind: 'TEXT',
    });
  });

  it('rechaza SVG, ejecutables, comprimidos y binarios disfrazados de texto', async () => {
    await expect(
      inspector.inspect(
        'logo.svg',
        text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      ),
    ).resolves.toBeNull();
    await expect(inspector.inspect('setup.pdf', bytes(0x4d, 0x5a, 0x90, 0x00))).resolves.toBeNull();
    await expect(
      inspector.inspect('datos.zip', bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0, 0)),
    ).resolves.toBeNull();
    await expect(inspector.inspect('notas.txt', bytes(0x00, 0x01, 0x02, 0xff))).resolves.toBeNull();
    await expect(inspector.inspect('sin-extension', text('hola'))).resolves.toBeNull();
  });
});
