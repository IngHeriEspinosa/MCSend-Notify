/**
 * Mapeo de columnas de un archivo de importación a campos de contacto y validación por fila.
 * Función pura: la usa el worker y se prueba sin infraestructura.
 */
import { z } from 'zod';
import { normalizeEmail } from '@/core/identity/email';
import type { ContactWriteData } from './contact';
import {
  normalizeAttributeValue,
  type AttributeValue,
  type ContactFieldDefinition,
} from './contact-fields';

export const STANDARD_IMPORT_TARGETS = [
  'email',
  'firstName',
  'lastName',
  'company',
  'locale',
  'timezone',
  'externalId',
] as const;

export const IGNORE_TARGET = 'ignore';
export const ATTRIBUTE_TARGET_PREFIX = 'attr.';

export type ImportMapping = Record<string, string>;

const MAX_LENGTH: Record<(typeof STANDARD_IMPORT_TARGETS)[number], number> = {
  email: 254,
  firstName: 100,
  lastName: 100,
  company: 200,
  locale: 5,
  timezone: 64,
  externalId: 128,
};

export type ImportRowError =
  'EMAIL_MISSING' | 'EMAIL_INVALID' | 'VALUE_TOO_LONG' | 'LOCALE_INVALID' | `ATTRIBUTE_${string}`;

/** Errores de configuración del mapeo (antes de encolar la importación). */
export function validateImportMapping(
  mapping: ImportMapping,
  headers: readonly string[],
  fields: readonly ContactFieldDefinition[],
): string[] {
  const errors: string[] = [];
  const fieldKeys = new Set(fields.map((field) => field.key));
  const targets = Object.entries(mapping).filter(([, target]) => target !== IGNORE_TARGET);

  for (const [column, target] of targets) {
    if (!headers.includes(column)) errors.push(`UNKNOWN_COLUMN:${column}`);
    const isStandard = (STANDARD_IMPORT_TARGETS as readonly string[]).includes(target);
    const isAttribute =
      target.startsWith(ATTRIBUTE_TARGET_PREFIX) &&
      fieldKeys.has(target.slice(ATTRIBUTE_TARGET_PREFIX.length));
    if (!isStandard && !isAttribute) errors.push(`UNKNOWN_TARGET:${target}`);
  }
  const used = targets.map(([, target]) => target);
  if (!used.includes('email')) errors.push('EMAIL_COLUMN_REQUIRED');
  const duplicates = used.filter((target, index) => used.indexOf(target) !== index);
  for (const target of new Set(duplicates)) errors.push(`DUPLICATE_TARGET:${target}`);
  return errors;
}

const emailSchema = z.email();

export type MappedRow =
  | { ok: true; data: ContactWriteData }
  | { ok: false; email: string | null; errors: ImportRowError[] };

export function mapImportRow(
  row: Record<string, string>,
  mapping: ImportMapping,
  fields: readonly ContactFieldDefinition[],
  options: { consentSource: string | null; consentAt: Date },
): MappedRow {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const errors: ImportRowError[] = [];
  const standard: Partial<Record<(typeof STANDARD_IMPORT_TARGETS)[number], string>> = {};
  const attributes: Record<string, AttributeValue> = {};

  for (const [column, target] of Object.entries(mapping)) {
    if (target === IGNORE_TARGET) continue;
    const value = (row[column] ?? '').trim();
    if (target.startsWith(ATTRIBUTE_TARGET_PREFIX)) {
      const key = target.slice(ATTRIBUTE_TARGET_PREFIX.length);
      const field = fieldsByKey.get(key);
      if (!field) continue;
      const result = normalizeAttributeValue(field, value);
      if (!result.ok) errors.push(`ATTRIBUTE_${key}_${result.reason}`);
      else if (result.value !== null) attributes[key] = result.value;
      continue;
    }
    const standardTarget = target as (typeof STANDARD_IMPORT_TARGETS)[number];
    if (value.length > MAX_LENGTH[standardTarget]) errors.push('VALUE_TOO_LONG');
    if (value !== '') standard[standardTarget] = value;
  }

  const email = standard.email ?? null;
  if (!email) errors.push('EMAIL_MISSING');
  else if (!emailSchema.safeParse(email).success) errors.push('EMAIL_INVALID');
  const locale = standard.locale?.toLowerCase();
  if (locale && locale !== 'es' && locale !== 'en') errors.push('LOCALE_INVALID');

  if (errors.length > 0 || !email) {
    return { ok: false, email, errors };
  }
  return {
    ok: true,
    data: {
      email,
      emailNormalized: normalizeEmail(email),
      firstName: standard.firstName ?? null,
      lastName: standard.lastName ?? null,
      company: standard.company ?? null,
      locale: locale ?? null,
      timezone: standard.timezone ?? null,
      externalId: standard.externalId ?? null,
      attributes,
      source: 'import',
      consentAt: options.consentSource ? options.consentAt : null,
      consentSource: options.consentSource,
    },
  };
}

/** Sugerencia automática de mapeo a partir de los nombres de columna (ES/EN). */
const HEADER_ALIASES: Record<string, string> = {
  email: 'email',
  'e-mail': 'email',
  correo: 'email',
  'correo electronico': 'email',
  'correo electrónico': 'email',
  nombre: 'firstName',
  'first name': 'firstName',
  firstname: 'firstName',
  apellido: 'lastName',
  apellidos: 'lastName',
  'last name': 'lastName',
  lastname: 'lastName',
  empresa: 'company',
  company: 'company',
  compañia: 'company',
  compañía: 'company',
  idioma: 'locale',
  language: 'locale',
  locale: 'locale',
  'zona horaria': 'timezone',
  timezone: 'timezone',
  id: 'externalId',
  'external id': 'externalId',
  'id externo': 'externalId',
};

export function suggestImportMapping(
  headers: readonly string[],
  fields: readonly ContactFieldDefinition[],
): ImportMapping {
  const used = new Set<string>();
  const mapping: ImportMapping = {};
  for (const header of headers) {
    const normalized = header.trim().toLowerCase();
    const field = fields.find(
      (candidate) => candidate.key === normalized || candidate.label.toLowerCase() === normalized,
    );
    const target =
      HEADER_ALIASES[normalized] ??
      (field ? `${ATTRIBUTE_TARGET_PREFIX}${field.key}` : IGNORE_TARGET);
    if (target !== IGNORE_TARGET && used.has(target)) {
      mapping[header] = IGNORE_TARGET;
    } else {
      mapping[header] = target;
      used.add(target);
    }
  }
  return mapping;
}
