/**
 * Operaciones sobre PDF con poppler-utils (instalado en la imagen del worker):
 * `pdfinfo` (páginas), `pdftoppm` (primera página a PNG) y `pdftotext` (texto).
 *
 * Se invocan con `execFile` (sin shell, sin interpolar argumentos), con tiempo máximo y tope de
 * salida, sobre un archivo temporal en un directorio propio que se elimina siempre al terminar.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DocumentProcessingError } from '@/core/documents/document';
import type { PdfToolkit } from '@/core/documents/ports';

const run = promisify(execFile);
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

function isMissingBinary(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export class PopplerPdfToolkit implements PdfToolkit {
  constructor(private readonly binDir?: string) {}

  async pageCount(pdf: Uint8Array): Promise<number> {
    const output = await this.withPdf(pdf, async (file) =>
      this.exec('pdfinfo', [file], 'INVALID_FILE'),
    );
    const pages = /^Pages:\s+(\d+)/m.exec(output)?.[1];
    if (!pages) throw new DocumentProcessingError('INVALID_FILE', 'pdfinfo no devolvió páginas');
    return Number(pages);
  }

  renderFirstPage(pdf: Uint8Array, width: number): Promise<Uint8Array> {
    return this.withPdf(pdf, async (file, dir) => {
      const prefix = join(dir, 'page');
      await this.exec(
        'pdftoppm',
        [
          '-f',
          '1',
          '-l',
          '1',
          '-png',
          '-singlefile',
          '-scale-to-x',
          String(width),
          '-scale-to-y',
          '-1',
          file,
          prefix,
        ],
        'RENDER_FAILED',
      );
      return new Uint8Array(await readFile(`${prefix}.png`));
    });
  }

  async extractText(pdf: Uint8Array, maxPages: number): Promise<string> {
    const text = await this.withPdf(pdf, (file) =>
      this.exec(
        'pdftotext',
        ['-f', '1', '-l', String(maxPages), '-enc', 'UTF-8', file, '-'],
        'RENDER_FAILED',
      ),
    );
    // pdftotext separa las páginas con un salto de página (form feed): se sustituye por líneas.
    return text.replace(/\f/g, '\n\n').replace(/\n{3,}/g, '\n\n');
  }

  private binary(name: string): string {
    return this.binDir ? join(this.binDir, name) : name;
  }

  private async exec(
    name: string,
    args: string[],
    failureCode: 'INVALID_FILE' | 'RENDER_FAILED',
  ): Promise<string> {
    try {
      const { stdout } = await run(this.binary(name), args, {
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        encoding: 'utf8',
      });
      return stdout;
    } catch (error) {
      if (isMissingBinary(error)) {
        throw new DocumentProcessingError('TOOLS_UNAVAILABLE', `${name} no está instalado`, {
          cause: error,
        });
      }
      throw new DocumentProcessingError(failureCode, `${name} falló`, { cause: error });
    }
  }

  private async withPdf<T>(
    pdf: Uint8Array,
    task: (file: string, dir: string) => Promise<T>,
  ): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'mcsn-pdf-'));
    try {
      const file = join(dir, 'document.pdf');
      await writeFile(file, pdf);
      return await task(file, dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
