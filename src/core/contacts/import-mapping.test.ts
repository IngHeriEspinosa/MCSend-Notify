import { describe, expect, it } from 'vitest';
import { normalizeAttributes, normalizeDate, type ContactFieldDefinition } from './contact-fields';
import { mapImportRow, suggestImportMapping, validateImportMapping } from './import-mapping';
import { detectImportFileType } from './use-cases/imports.use-cases';

const FIELDS: ContactFieldDefinition[] = [
  { id: 'f1', key: 'country', label: 'País', type: 'SELECT', options: ['DO', 'GT'] },
  { id: 'f2', key: 'seats', label: 'Licencias', type: 'NUMBER', options: [] },
  { id: 'f3', key: 'renewal', label: 'Renovación', type: 'DATE', options: [] },
];

describe('normalización de atributos', () => {
  it('normaliza fechas en formatos habituales', () => {
    expect(normalizeDate('2026-12-01')).toBe('2026-12-01');
    expect(normalizeDate('1/12/2026')).toBe('2026-12-01');
    expect(normalizeDate('2026-12-01T10:00:00Z')).toBe('2026-12-01');
    expect(normalizeDate('31/02/2026')).toBeNull();
  });

  it('canoniza opciones y rechaza campos desconocidos', () => {
    const { attributes, errors } = normalizeAttributes(FIELDS, {
      country: 'do',
      seats: '12',
      otro: 'x',
    });
    expect(attributes).toEqual({ country: 'DO', seats: 12 });
    expect(errors).toEqual([{ key: 'otro', reason: 'UNKNOWN_FIELD' }]);
  });
});

describe('mapeo de importación', () => {
  const headers = ['Correo', 'Nombre', 'País', 'Licencias', 'Notas'];

  it('sugiere el mapeo por nombre de columna y etiqueta de campo', () => {
    expect(suggestImportMapping(headers, FIELDS)).toEqual({
      Correo: 'email',
      Nombre: 'firstName',
      País: 'attr.country',
      Licencias: 'attr.seats',
      Notas: 'ignore',
    });
  });

  it('exige una columna de email y destinos únicos', () => {
    expect(validateImportMapping({ Nombre: 'firstName' }, headers, FIELDS)).toContain(
      'EMAIL_COLUMN_REQUIRED',
    );
    expect(
      validateImportMapping(
        { Correo: 'email', Nombre: 'firstName', Notas: 'firstName' },
        headers,
        FIELDS,
      ),
    ).toContain('DUPLICATE_TARGET:firstName');
  });

  it('convierte una fila válida en datos normalizados', () => {
    const mapping = suggestImportMapping(headers, FIELDS);
    const result = mapImportRow(
      { Correo: ' Ana@Cliente.COM ', Nombre: 'Ana', País: 'gt', Licencias: '5', Notas: 'x' },
      mapping,
      FIELDS,
      { consentSource: 'Feria 2026', consentAt: new Date('2026-10-02T00:00:00Z') },
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        email: 'Ana@Cliente.COM',
        emailNormalized: 'ana@cliente.com',
        firstName: 'Ana',
        attributes: { country: 'GT', seats: 5 },
        source: 'import',
        consentSource: 'Feria 2026',
      },
    });
  });

  it('acumula todos los errores de una fila inválida', () => {
    const mapping = suggestImportMapping(headers, FIELDS);
    const result = mapImportRow(
      { Correo: 'no-es-email', País: 'MX', Licencias: 'muchas' },
      mapping,
      FIELDS,
      {
        consentSource: null,
        consentAt: new Date(),
      },
    );
    expect(result).toEqual({
      ok: false,
      email: 'no-es-email',
      errors: [
        'ATTRIBUTE_country_INVALID_OPTION',
        'ATTRIBUTE_seats_INVALID_NUMBER',
        'EMAIL_INVALID',
      ],
    });
  });
});

describe('detectImportFileType', () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]);
  const text = new TextEncoder().encode('email,nombre\na@b.com,Ana');

  it('identifica el tipo por contenido y no solo por extensión', () => {
    expect(detectImportFileType('contactos.xlsx', zip)).toBe('xlsx');
    expect(detectImportFileType('contactos.csv', text)).toBe('csv');
    expect(detectImportFileType('contactos.xlsx', text)).toBeNull();
    expect(detectImportFileType('contactos.csv', zip)).toBeNull();
    expect(detectImportFileType('script.exe', text)).toBeNull();
  });
});
