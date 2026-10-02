/**
 * Conversión real con Gotenberg (contenedor de desarrollo en el puerto 3100): presentación PPTX,
 * hoja de cálculo, HTML y Markdown a PDF. Comprueba también que un HTML con recursos de la red
 * interna se convierte sin acceder a ellos (lista de permitidos de Chromium en compose.yaml).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { GotenbergDocumentConverter } from '@/infrastructure/documents/gotenberg-converter';

const converter = new GotenbergDocumentConverter(
  process.env.GOTENBERG_URL ?? 'http://localhost:3100',
);
const isPdf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
const text = (value: string) => new TextEncoder().encode(value);

describe('GotenbergDocumentConverter', () => {
  it('convierte una presentación PPTX', async () => {
    const deck = new Uint8Array(readFileSync('prisma/seed-assets/sample-deck.pptx'));
    const pdf = await converter.toPdf({ kind: 'PRESENTATION', extension: 'pptx', bytes: deck });
    expect(isPdf(pdf)).toBe(true);
  });

  it('convierte una hoja de cálculo XLSX', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Cliente', 'Tickets'],
        ['Banco Popular', 42],
      ]),
      'Resumen',
    );
    const bytes = new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
    const pdf = await converter.toPdf({ kind: 'SPREADSHEET', extension: 'xlsx', bytes });
    expect(isPdf(pdf)).toBe(true);
  });

  it('convierte Markdown y texto plano', async () => {
    const markdown = await converter.toPdf({
      kind: 'MARKDOWN',
      extension: 'md',
      bytes: text('# Novedades\n\n- Uno\n- Dos'),
    });
    const plain = await converter.toPdf({ kind: 'TEXT', extension: 'txt', bytes: text('hola') });
    expect(isPdf(markdown)).toBe(true);
    expect(isPdf(plain)).toBe(true);
  });

  it('convierte HTML con referencias internas sin acceder a ellas', async () => {
    const pdf = await converter.toPdf({
      kind: 'HTML',
      extension: 'html',
      bytes: text(
        '<h1>Hola</h1><img src="http://169.254.169.254/latest/meta-data/"><script>document.title="x"</script>',
      ),
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it('una presentación dañada (truncada) produce CONVERSION_FAILED', async () => {
    const truncated = new Uint8Array(readFileSync('prisma/seed-assets/sample-deck.pptx')).subarray(
      0,
      2000,
    );
    await expect(
      converter.toPdf({ kind: 'PRESENTATION', extension: 'pptx', bytes: truncated }),
    ).rejects.toMatchObject({ code: 'CONVERSION_FAILED' });
  });

  it('extrae el texto de HTML sin etiquetas', () => {
    expect(
      converter.textFromSource(
        'HTML',
        text('<h1>Título</h1><p>Uno &amp; dos</p><script>x</script>'),
      ),
    ).toContain('Uno & dos');
  });
});
