/**
 * Lenguaje de reglas de segmentos (DSL) validado con Zod, catálogo de campos y evaluador en memoria.
 *
 * El evaluador define la semántica de referencia. El compilador SQL de infraestructura
 * (segment-sql.ts) debe producir los mismos resultados; lo verifica un test de integración.
 * Semántica de vacíos: un texto nulo equivale a "", "no es igual a" incluye los vacíos y
 * "es falso" incluye los contactos sin valor.
 */
import { z } from 'zod';
import { DomainError } from '@/core/shared/domain-error';
import { CONTACT_STATUSES } from './contact';
import type { AttributeValue, ContactFieldDefinition, FieldType } from './contact-fields';

export const SEGMENT_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'inLastDays',
  'notInLastDays',
  'isTrue',
  'isFalse',
  'in',
  'notIn',
  'inList',
  'notInList',
  'hasTag',
  'notHasTag',
] as const;

export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number];

export type SegmentFieldKind = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'list' | 'tag';

export const OPERATORS_BY_KIND: Record<SegmentFieldKind, readonly SegmentOperator[]> = {
  text: ['equals', 'notEquals', 'contains', 'notContains', 'startsWith', 'isEmpty', 'isNotEmpty'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'],
  date: ['before', 'after', 'inLastDays', 'notInLastDays', 'isEmpty', 'isNotEmpty'],
  boolean: ['isTrue', 'isFalse'],
  select: ['equals', 'notEquals', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
  list: ['inList', 'notInList'],
  tag: ['hasTag', 'notHasTag'],
};

const VALUELESS_OPERATORS: ReadonlySet<SegmentOperator> = new Set([
  'isEmpty',
  'isNotEmpty',
  'isTrue',
  'isFalse',
]);

export const MAX_SEGMENT_DEPTH = 3;
export const MAX_SEGMENT_RULES = 50;

export interface SegmentRule {
  field: string;
  operator: SegmentOperator;
  value?: string | number | string[] | undefined;
}

export interface SegmentRuleSet {
  combinator: 'and' | 'or';
  rules: Array<SegmentRule | SegmentRuleSet>;
}

export const segmentRuleSchema: z.ZodType<SegmentRule> = z.object({
  field: z.string().min(1).max(60),
  operator: z.enum(SEGMENT_OPERATORS),
  value: z
    .union([z.string().max(500), z.number(), z.array(z.string().max(200)).max(50)])
    .optional(),
});

export const segmentRuleSetSchema: z.ZodType<SegmentRuleSet> = z.lazy(() =>
  z.object({
    combinator: z.enum(['and', 'or']),
    rules: z
      .array(z.union([segmentRuleSchema, segmentRuleSetSchema]))
      .min(1)
      .max(20),
  }),
);

export function isRuleSet(node: SegmentRule | SegmentRuleSet): node is SegmentRuleSet {
  return 'combinator' in node;
}

// ----------------------------------------------------------------------------
// Catálogo de campos filtrables
// ----------------------------------------------------------------------------

export type BuiltinColumn =
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'locale'
  | 'status'
  | 'createdAt'
  | 'lastEngagedAt';

export interface SegmentFieldDescriptor {
  id: string;
  kind: SegmentFieldKind;
  /** Columna del contacto (campos estándar). */
  column?: BuiltinColumn;
  /** Clave en `attributes` (campos personalizados). */
  attributeKey?: string;
  options?: readonly string[];
  /** Fecha guardada como timestamp (columna) o como "YYYY-MM-DD" (atributo). */
  dateStorage?: 'timestamp' | 'isoDate';
}

const BUILTIN_FIELDS: readonly SegmentFieldDescriptor[] = [
  { id: 'email', kind: 'text', column: 'email' },
  { id: 'firstName', kind: 'text', column: 'firstName' },
  { id: 'lastName', kind: 'text', column: 'lastName' },
  { id: 'company', kind: 'text', column: 'company' },
  { id: 'locale', kind: 'select', column: 'locale', options: ['es', 'en'] },
  { id: 'status', kind: 'select', column: 'status', options: CONTACT_STATUSES },
  { id: 'createdAt', kind: 'date', column: 'createdAt', dateStorage: 'timestamp' },
  { id: 'lastEngagedAt', kind: 'date', column: 'lastEngagedAt', dateStorage: 'timestamp' },
  { id: 'list', kind: 'list' },
  { id: 'tag', kind: 'tag' },
];

const KIND_BY_FIELD_TYPE: Record<FieldType, SegmentFieldKind> = {
  STRING: 'text',
  NUMBER: 'number',
  DATE: 'date',
  BOOLEAN: 'boolean',
  SELECT: 'select',
};

export const ATTRIBUTE_FIELD_PREFIX = 'attr.';

export type SegmentCatalog = ReadonlyMap<string, SegmentFieldDescriptor>;

export function buildSegmentCatalog(fields: readonly ContactFieldDefinition[]): SegmentCatalog {
  const custom = fields.map<SegmentFieldDescriptor>((field) => ({
    id: `${ATTRIBUTE_FIELD_PREFIX}${field.key}`,
    kind: KIND_BY_FIELD_TYPE[field.type],
    attributeKey: field.key,
    options: field.options,
    dateStorage: 'isoDate',
  }));
  return new Map([...BUILTIN_FIELDS, ...custom].map((field) => [field.id, field]));
}

// ----------------------------------------------------------------------------
// Validación semántica
// ----------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ruleError(path: string, reason: string): DomainError {
  return new DomainError('VALIDATION', `Regla de segmento inválida en ${path}: ${reason}`, {
    path,
    reason,
  });
}

function validateRuleValue(rule: SegmentRule, field: SegmentFieldDescriptor, path: string): void {
  if (VALUELESS_OPERATORS.has(rule.operator)) return;
  const { value } = rule;
  switch (rule.operator) {
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      if (typeof value !== 'number') throw ruleError(path, 'NUMBER_REQUIRED');
      return;
    case 'equals':
    case 'notEquals':
      if (field.kind === 'number') {
        if (typeof value !== 'number') throw ruleError(path, 'NUMBER_REQUIRED');
        return;
      }
      if (typeof value !== 'string' || value === '') throw ruleError(path, 'TEXT_REQUIRED');
      if (field.kind === 'select' && !field.options?.includes(value)) {
        throw ruleError(path, 'INVALID_OPTION');
      }
      return;
    case 'in':
    case 'notIn':
      if (!Array.isArray(value) || value.length === 0) throw ruleError(path, 'OPTIONS_REQUIRED');
      if (value.some((option) => !field.options?.includes(option))) {
        throw ruleError(path, 'INVALID_OPTION');
      }
      return;
    case 'before':
    case 'after':
      if (typeof value !== 'string' || !ISO_DATE.test(value))
        throw ruleError(path, 'DATE_REQUIRED');
      return;
    case 'inLastDays':
    case 'notInLastDays':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3650) {
        throw ruleError(path, 'DAYS_REQUIRED');
      }
      return;
    case 'inList':
    case 'notInList':
    case 'hasTag':
    case 'notHasTag':
      if (typeof value !== 'string' || !UUID.test(value)) throw ruleError(path, 'ID_REQUIRED');
      return;
    default:
      if (typeof value !== 'string' || value === '') throw ruleError(path, 'TEXT_REQUIRED');
  }
}

/** Valida campos, operadores, valores, profundidad y número de reglas. Lanza VALIDATION. */
export function validateSegmentRules(ruleSet: SegmentRuleSet, catalog: SegmentCatalog): void {
  let ruleCount = 0;
  const visit = (node: SegmentRuleSet, depth: number, path: string) => {
    if (depth > MAX_SEGMENT_DEPTH) throw ruleError(path, 'TOO_DEEP');
    if (node.rules.length === 0) throw ruleError(path, 'EMPTY_GROUP');
    node.rules.forEach((child, index) => {
      const childPath = `${path}.rules[${index}]`;
      if (isRuleSet(child)) {
        visit(child, depth + 1, childPath);
        return;
      }
      ruleCount += 1;
      if (ruleCount > MAX_SEGMENT_RULES) throw ruleError(childPath, 'TOO_MANY_RULES');
      const field = catalog.get(child.field);
      if (!field) throw ruleError(childPath, 'UNKNOWN_FIELD');
      if (!OPERATORS_BY_KIND[field.kind].includes(child.operator)) {
        throw ruleError(childPath, 'INVALID_OPERATOR');
      }
      validateRuleValue(child, field, childPath);
    });
  };
  visit(ruleSet, 1, 'root');
}

// ----------------------------------------------------------------------------
// Evaluador en memoria (semántica de referencia)
// ----------------------------------------------------------------------------

export interface SegmentSubject {
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  locale: string | null;
  status: string;
  createdAt: Date;
  lastEngagedAt: Date | null;
  attributes: Record<string, AttributeValue>;
  listIds: readonly string[];
  tagIds: readonly string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function readText(subject: SegmentSubject, field: SegmentFieldDescriptor): string {
  const raw = field.column ? subject[field.column] : subject.attributes[field.attributeKey ?? ''];
  return raw === null || raw === undefined ? '' : String(raw);
}

function evaluateText(operator: SegmentOperator, text: string, value: unknown): boolean {
  const actual = text.toLowerCase();
  const expected = typeof value === 'string' ? value.toLowerCase() : '';
  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'notEquals':
      return actual !== expected;
    case 'contains':
      return actual.includes(expected);
    case 'notContains':
      return !actual.includes(expected);
    case 'startsWith':
      return actual.startsWith(expected);
    case 'isEmpty':
      return actual === '';
    case 'isNotEmpty':
      return actual !== '';
    case 'in':
      return Array.isArray(value) && value.some((option) => option.toLowerCase() === actual);
    case 'notIn':
      return !(Array.isArray(value) && value.some((option) => option.toLowerCase() === actual));
    default:
      return false;
  }
}

function evaluateNumber(operator: SegmentOperator, actual: unknown, value: unknown): boolean {
  const number = typeof actual === 'number' ? actual : null;
  if (operator === 'isEmpty') return number === null;
  if (operator === 'isNotEmpty') return number !== null;
  if (operator === 'notEquals') return number === null || number !== value;
  if (number === null || typeof value !== 'number') return false;
  switch (operator) {
    case 'equals':
      return number === value;
    case 'gt':
      return number > value;
    case 'gte':
      return number >= value;
    case 'lt':
      return number < value;
    case 'lte':
      return number <= value;
    default:
      return false;
  }
}

function evaluateDate(
  operator: SegmentOperator,
  field: SegmentFieldDescriptor,
  subject: SegmentSubject,
  value: unknown,
  now: Date,
): boolean {
  let day: string | null;
  let instant: number | null;
  if (field.dateStorage === 'timestamp' && field.column) {
    const raw = subject[field.column];
    instant = raw instanceof Date ? raw.getTime() : null;
    day = raw instanceof Date ? isoDay(raw) : null;
  } else {
    const raw = subject.attributes[field.attributeKey ?? ''];
    day = typeof raw === 'string' ? raw : null;
    instant = day ? Date.parse(`${day}T00:00:00.000Z`) : null;
  }
  const threshold = typeof value === 'number' ? now.getTime() - value * DAY_MS : 0;
  const thresholdDay = isoDay(new Date(threshold));
  const isTimestamp = field.dateStorage === 'timestamp';
  switch (operator) {
    case 'isEmpty':
      return day === null;
    case 'isNotEmpty':
      return day !== null;
    case 'before':
      return day !== null && typeof value === 'string' && day < value;
    case 'after':
      return day !== null && typeof value === 'string' && day > value;
    case 'inLastDays':
      if (instant === null || day === null) return false;
      return isTimestamp ? instant >= threshold : day >= thresholdDay;
    case 'notInLastDays':
      if (instant === null || day === null) return true;
      return isTimestamp ? instant < threshold : day < thresholdDay;
    default:
      return false;
  }
}

function evaluateRule(
  rule: SegmentRule,
  catalog: SegmentCatalog,
  subject: SegmentSubject,
  now: Date,
) {
  const field = catalog.get(rule.field);
  if (!field) return false;
  switch (field.kind) {
    case 'text':
    case 'select':
      return evaluateText(rule.operator, readText(subject, field), rule.value);
    case 'number':
      return evaluateNumber(
        rule.operator,
        subject.attributes[field.attributeKey ?? ''],
        rule.value,
      );
    case 'date':
      return evaluateDate(rule.operator, field, subject, rule.value, now);
    case 'boolean': {
      const isTrue = subject.attributes[field.attributeKey ?? ''] === true;
      return rule.operator === 'isTrue' ? isTrue : !isTrue;
    }
    case 'list': {
      const member = subject.listIds.includes(String(rule.value));
      return rule.operator === 'inList' ? member : !member;
    }
    case 'tag': {
      const tagged = subject.tagIds.includes(String(rule.value));
      return rule.operator === 'hasTag' ? tagged : !tagged;
    }
  }
}

export function evaluateSegment(
  ruleSet: SegmentRuleSet,
  catalog: SegmentCatalog,
  subject: SegmentSubject,
  now: Date,
): boolean {
  const results = ruleSet.rules.map((node) =>
    isRuleSet(node)
      ? evaluateSegment(node, catalog, subject, now)
      : evaluateRule(node, catalog, subject, now),
  );
  return ruleSet.combinator === 'and' ? results.every(Boolean) : results.some(Boolean);
}
