/**
 * Campos personalizados de contacto y normalización de sus valores.
 * Los valores se guardan normalizados en `Contact.attributes`:
 * STRING → texto, NUMBER → número, DATE → "YYYY-MM-DD", BOOLEAN → booleano, SELECT → opción canónica.
 */
import { z } from 'zod';

export const FIELD_TYPES = ['STRING', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT'] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type AttributeValue = string | number | boolean;

export interface ContactFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
}

export const contactFieldKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const createContactFieldSchema = z
  .object({
    key: contactFieldKeySchema,
    label: z.string().trim().min(1).max(80),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  })
  .refine((field) => field.type !== 'SELECT' || field.options.length > 0, {
    message: 'Un campo de selección necesita opciones',
    path: ['options'],
  })
  .transform((field) => ({
    ...field,
    options: field.type === 'SELECT' ? [...new Set(field.options)] : [],
  }));

export type CreateContactFieldInput = z.infer<typeof createContactFieldSchema>;

export type AttributeErrorReason =
  | 'UNKNOWN_FIELD'
  | 'INVALID_NUMBER'
  | 'INVALID_DATE'
  | 'INVALID_BOOLEAN'
  | 'INVALID_OPTION'
  | 'TOO_LONG';

type NormalizeResult =
  { ok: true; value: AttributeValue | null } | { ok: false; reason: AttributeErrorReason };

const TRUE_VALUES = new Set(['true', '1', 'si', 'sí', 'yes', 'y', 'verdadero', 'x']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', 'falso']);
const MAX_TEXT_LENGTH = 1000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Acepta YYYY-MM-DD, DD/MM/YYYY (formato habitual en la región), ISO con hora y Date. */
export function normalizeDate(raw: unknown): string | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : local
      ? [Number(local[3]), Number(local[2]), Number(local[1])]
      : [NaN, NaN, NaN];
  if (!isValidDate(year, month, day)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function normalizeAttributeValue(
  field: ContactFieldDefinition,
  raw: unknown,
): NormalizeResult {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { ok: true, value: null };
  }
  switch (field.type) {
    case 'STRING': {
      const text = String(raw).trim();
      return text.length > MAX_TEXT_LENGTH
        ? { ok: false, reason: 'TOO_LONG' }
        : { ok: true, value: text };
    }
    case 'NUMBER': {
      const number = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(number)
        ? { ok: true, value: number }
        : { ok: false, reason: 'INVALID_NUMBER' };
    }
    case 'DATE': {
      const date = normalizeDate(raw);
      return date ? { ok: true, value: date } : { ok: false, reason: 'INVALID_DATE' };
    }
    case 'BOOLEAN': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      const text = String(raw).trim().toLowerCase();
      if (TRUE_VALUES.has(text)) return { ok: true, value: true };
      if (FALSE_VALUES.has(text)) return { ok: true, value: false };
      return { ok: false, reason: 'INVALID_BOOLEAN' };
    }
    case 'SELECT': {
      const text = String(raw).trim().toLowerCase();
      const option = field.options.find((candidate) => candidate.toLowerCase() === text);
      return option ? { ok: true, value: option } : { ok: false, reason: 'INVALID_OPTION' };
    }
  }
}

export interface AttributeError {
  key: string;
  reason: AttributeErrorReason;
}

/** Normaliza un mapa de atributos contra las definiciones. Los valores vacíos se omiten. */
export function normalizeAttributes(
  fields: readonly ContactFieldDefinition[],
  raw: Record<string, unknown>,
): { attributes: Record<string, AttributeValue>; errors: AttributeError[] } {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const attributes: Record<string, AttributeValue> = {};
  const errors: AttributeError[] = [];

  for (const [key, value] of Object.entries(raw)) {
    const field = byKey.get(key);
    if (!field) {
      errors.push({ key, reason: 'UNKNOWN_FIELD' });
      continue;
    }
    const result = normalizeAttributeValue(field, value);
    if (!result.ok) {
      errors.push({ key, reason: result.reason });
    } else if (result.value !== null) {
      attributes[key] = result.value;
    }
  }
  return { attributes, errors };
}
