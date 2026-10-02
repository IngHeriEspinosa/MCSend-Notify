import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { decodeText, normalizeHeaders, PapaXlsxSpreadsheetReader } from './spreadsheet-reader';

const reader = new PapaXlsxSpreadsheetReader();

async function* streamOf(bytes: Uint8Array) {
  yield bytes;
}

async function collectRows(iterable: AsyncIterable<Record<string, string>>) {
  const rows: Array<Record<string, string>> = [];
  for await (const row of iterable) rows.push(row);
  return rows;
}

describe('decodeText', () => {
  it('detecta UTF-8 y recurre a Windows-1252', () => {
    expect(decodeText(new TextEncoder().encode('Compañía'))).toBe('Compañía');
    expect(decodeText(new Uint8Array([0x43, 0x6f, 0x6d, 0x70, 0x61, 0xf1, 0xed, 0x61]))).toBe(
      'Compañía',
    );
  });
});

describe('normalizeHeaders', () => {
  it('renombra cabeceras vacías y repetidas', () => {
    expect(normalizeHeaders(['Email', '', 'Email', ' Nombre '])).toEqual([
      'Email',
      'Columna 2',
      'Email (2)',
      'Nombre',
    ]);
  });
});

describe('PapaXlsxSpreadsheetReader', () => {
  it('lee CSV separado por punto y coma con BOM y comillas', async () => {
    const csv = '﻿Email;Nombre;Empresa\na@b.com;Ana;"Banco; Popular"\n\nb@c.com;Luis;\n';
    const bytes = new TextEncoder().encode(csv);

    const preview = await reader.preview(bytes, 'csv', 20);
    expect(preview.headers).toEqual(['Email', 'Nombre', 'Empresa']);
    expect(preview.rows).toEqual([
      ['a@b.com', 'Ana', 'Banco; Popular'],
      ['b@c.com', 'Luis', ''],
    ]);

    const rows = await collectRows(reader.readRows(streamOf(bytes), 'csv'));
    expect(rows).toEqual([
      { Email: 'a@b.com', Nombre: 'Ana', Empresa: 'Banco; Popular' },
      { Email: 'b@c.com', Nombre: 'Luis', Empresa: '' },
    ]);
  });

  it('lee XLSX con fechas convertidas a YYYY-MM-DD', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Email', 'Renovación', 'Licencias'],
      ['a@b.com', new Date(Date.UTC(2026, 11, 1)), 25],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Contactos');
    const bytes = new Uint8Array(
      XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
    );

    const rows = await collectRows(reader.readRows(streamOf(bytes), 'xlsx'));
    expect(rows).toEqual([{ Email: 'a@b.com', Renovación: '2026-12-01', Licencias: '25' }]);
  });
});
