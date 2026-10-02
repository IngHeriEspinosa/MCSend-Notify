/**
 * Lectura de archivos de importación.
 * - CSV: detecta el separador (coma, punto y coma, tabulador) y la codificación
 *   (UTF-8, con fallback a Windows-1252, habitual en exportaciones de Excel en español).
 * - XLSX: primera hoja, fechas en UTC convertidas a "YYYY-MM-DD".
 * Las cabeceras vacías o repetidas se renombran para que cada columna sea única.
 */
import Papa from 'papaparse';
import { Readable } from 'node:stream';
import * as XLSX from 'xlsx';
import type { ImportFileType, SpreadsheetPreview, SpreadsheetReader } from '@/core/contacts/ports';
import type { ByteStream } from '@/core/shared/ports';

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function normalizeHeaders(raw: readonly unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((value, index) => {
    const base = String(value ?? '').trim() || `Columna ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function cellToString(value: unknown): string {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function readXlsxRows(bytes: Uint8Array): string[][] {
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true, dense: true });
  const firstSheet = workbook.SheetNames[0];
  const sheet = firstSheet ? workbook.Sheets[firstSheet] : undefined;
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
  return rows.map((row) => row.map(cellToString));
}

function parseCsvRows(text: string, maxRows?: number): string[][] {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    ...(maxRows ? { preview: maxRows } : {}),
  });
  return result.data.map((row) => row.map((cell) => cell.trim()));
}

async function collect(source: ByteStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class PapaXlsxSpreadsheetReader implements SpreadsheetReader {
  async preview(
    bytes: Uint8Array,
    fileType: ImportFileType,
    maxRows: number,
  ): Promise<SpreadsheetPreview> {
    const rows =
      fileType === 'xlsx'
        ? readXlsxRows(bytes).slice(0, maxRows + 1)
        : parseCsvRows(decodeText(bytes), maxRows + 1);
    const [headerRow, ...dataRows] = rows;
    if (!headerRow) return { headers: [], rows: [] };
    const headers = normalizeHeaders(headerRow);
    return { headers, rows: dataRows.map((row) => headers.map((_, index) => row[index] ?? '')) };
  }

  async *readRows(
    source: ByteStream,
    fileType: ImportFileType,
  ): AsyncIterable<Record<string, string>> {
    const bytes = await collect(source);
    if (fileType === 'xlsx') {
      const [headerRow, ...dataRows] = readXlsxRows(bytes);
      if (!headerRow) return;
      const headers = normalizeHeaders(headerRow);
      for (const row of dataRows) {
        yield Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
      }
      return;
    }

    // CSV en flujo: no materializa todas las filas en memoria.
    let headers: string[] | null = null;
    const parser = Readable.from([decodeText(bytes)]).pipe(
      Papa.parse(Papa.NODE_STREAM_INPUT, { skipEmptyLines: 'greedy' }),
    );
    for await (const row of parser as AsyncIterable<string[]>) {
      if (!headers) {
        headers = normalizeHeaders(row);
        continue;
      }
      const values = row;
      yield Object.fromEntries(
        headers.map((header, index) => [header, (values[index] ?? '').trim()]),
      );
    }
  }
}
