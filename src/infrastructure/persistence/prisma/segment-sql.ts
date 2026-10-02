/**
 * Compila un SegmentRuleSet (ya validado) a un fragmento WHERE de PostgreSQL sobre `contacts c`.
 *
 * Seguridad (OWASP A03): los nombres de columna salen de una lista blanca fija y todo valor
 * del usuario (incluidas las claves de atributos) viaja como parámetro.
 * La semántica replica la del evaluador de referencia en src/core/contacts/segments.ts.
 */
import {
  isRuleSet,
  isoDay,
  type BuiltinColumn,
  type SegmentCatalog,
  type SegmentFieldDescriptor,
  type SegmentRule,
  type SegmentRuleSet,
} from '@/core/contacts/segments';
import { Prisma } from './generated/client';

const COLUMN_SQL: Record<BuiltinColumn, string> = {
  email: 'c.email',
  firstName: 'c.first_name',
  lastName: 'c.last_name',
  company: 'c.company',
  locale: 'c.locale',
  status: 'c.status::text',
  createdAt: 'c.created_at',
  lastEngagedAt: 'c.last_engaged_at',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Escapa los comodines de LIKE para buscar el texto literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Timestamp sin zona en UTC, como lo guarda Prisma en columnas `timestamp(3)`. */
function utcTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

function textExpression(field: SegmentFieldDescriptor): Prisma.Sql {
  if (field.column) return Prisma.sql`COALESCE(${Prisma.raw(COLUMN_SQL[field.column])}, '')`;
  return Prisma.sql`COALESCE(c.attributes ->> ${field.attributeKey ?? ''}, '')`;
}

function compileText(rule: SegmentRule, field: SegmentFieldDescriptor): Prisma.Sql {
  const text = textExpression(field);
  const value = typeof rule.value === 'string' ? rule.value : '';
  const options = Array.isArray(rule.value) ? rule.value.map((option) => option.toLowerCase()) : [];
  switch (rule.operator) {
    case 'equals':
      return Prisma.sql`lower(${text}) = lower(${value})`;
    case 'notEquals':
      return Prisma.sql`lower(${text}) <> lower(${value})`;
    case 'contains':
      return Prisma.sql`${text} ILIKE ${`%${escapeLike(value)}%`} ESCAPE '\\'`;
    case 'notContains':
      return Prisma.sql`NOT (${text} ILIKE ${`%${escapeLike(value)}%`} ESCAPE '\\')`;
    case 'startsWith':
      return Prisma.sql`${text} ILIKE ${`${escapeLike(value)}%`} ESCAPE '\\'`;
    case 'isEmpty':
      return Prisma.sql`${text} = ''`;
    case 'isNotEmpty':
      return Prisma.sql`${text} <> ''`;
    case 'in':
      return Prisma.sql`lower(${text}) = ANY(${options}::text[])`;
    case 'notIn':
      return Prisma.sql`NOT (lower(${text}) = ANY(${options}::text[]))`;
    default:
      throw new Error(`Operador de texto no soportado: ${rule.operator}`);
  }
}

function compileNumber(rule: SegmentRule, field: SegmentFieldDescriptor): Prisma.Sql {
  const key = field.attributeKey ?? '';
  const number = Prisma.sql`(CASE WHEN jsonb_typeof(c.attributes -> ${key}) = 'number' THEN (c.attributes ->> ${key})::numeric END)`;
  const value = typeof rule.value === 'number' ? rule.value : 0;
  switch (rule.operator) {
    case 'equals':
      return Prisma.sql`${number} = ${value}::numeric`;
    case 'notEquals':
      return Prisma.sql`(${number} IS NULL OR ${number} <> ${value}::numeric)`;
    case 'gt':
      return Prisma.sql`${number} > ${value}::numeric`;
    case 'gte':
      return Prisma.sql`${number} >= ${value}::numeric`;
    case 'lt':
      return Prisma.sql`${number} < ${value}::numeric`;
    case 'lte':
      return Prisma.sql`${number} <= ${value}::numeric`;
    case 'isEmpty':
      return Prisma.sql`${number} IS NULL`;
    case 'isNotEmpty':
      return Prisma.sql`${number} IS NOT NULL`;
    default:
      throw new Error(`Operador numérico no soportado: ${rule.operator}`);
  }
}

function compileDate(rule: SegmentRule, field: SegmentFieldDescriptor, now: Date): Prisma.Sql {
  const days = typeof rule.value === 'number' ? rule.value : 0;
  const threshold = new Date(now.getTime() - days * DAY_MS);
  const dayValue = typeof rule.value === 'string' ? rule.value : '';

  if (field.dateStorage === 'timestamp' && field.column) {
    const column = Prisma.raw(COLUMN_SQL[field.column]);
    switch (rule.operator) {
      case 'before':
        return Prisma.sql`${column}::date < ${dayValue}::date`;
      case 'after':
        return Prisma.sql`${column}::date > ${dayValue}::date`;
      case 'inLastDays':
        return Prisma.sql`${column} >= ${utcTimestamp(threshold)}::timestamp`;
      case 'notInLastDays':
        return Prisma.sql`(${column} IS NULL OR ${column} < ${utcTimestamp(threshold)}::timestamp)`;
      case 'isEmpty':
        return Prisma.sql`${column} IS NULL`;
      case 'isNotEmpty':
        return Prisma.sql`${column} IS NOT NULL`;
      default:
        throw new Error(`Operador de fecha no soportado: ${rule.operator}`);
    }
  }

  const key = field.attributeKey ?? '';
  const day = Prisma.sql`(CASE WHEN jsonb_typeof(c.attributes -> ${key}) = 'string' THEN c.attributes ->> ${key} END)`;
  switch (rule.operator) {
    case 'before':
      return Prisma.sql`${day} < ${dayValue}`;
    case 'after':
      return Prisma.sql`${day} > ${dayValue}`;
    case 'inLastDays':
      return Prisma.sql`${day} >= ${isoDay(threshold)}`;
    case 'notInLastDays':
      return Prisma.sql`(${day} IS NULL OR ${day} < ${isoDay(threshold)})`;
    case 'isEmpty':
      return Prisma.sql`${day} IS NULL`;
    case 'isNotEmpty':
      return Prisma.sql`${day} IS NOT NULL`;
    default:
      throw new Error(`Operador de fecha no soportado: ${rule.operator}`);
  }
}

function compileRule(rule: SegmentRule, catalog: SegmentCatalog, now: Date): Prisma.Sql {
  const field = catalog.get(rule.field);
  if (!field) throw new Error(`Campo de segmento desconocido: ${rule.field}`);
  switch (field.kind) {
    case 'text':
    case 'select':
      return compileText(rule, field);
    case 'number':
      return compileNumber(rule, field);
    case 'date':
      return compileDate(rule, field, now);
    case 'boolean': {
      const isTrue = Prisma.sql`COALESCE((c.attributes -> ${field.attributeKey ?? ''}) = 'true'::jsonb, false)`;
      return rule.operator === 'isTrue' ? isTrue : Prisma.sql`NOT ${isTrue}`;
    }
    case 'list': {
      const exists = Prisma.sql`EXISTS (SELECT 1 FROM list_memberships lm WHERE lm.contact_id = c.id AND lm.list_id = ${String(rule.value)}::uuid)`;
      return rule.operator === 'inList' ? exists : Prisma.sql`NOT ${exists}`;
    }
    case 'tag': {
      const exists = Prisma.sql`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ${String(rule.value)}::uuid)`;
      return rule.operator === 'hasTag' ? exists : Prisma.sql`NOT ${exists}`;
    }
  }
}

export function compileSegmentRules(
  ruleSet: SegmentRuleSet,
  catalog: SegmentCatalog,
  now: Date,
): Prisma.Sql {
  const parts = ruleSet.rules.map((node) =>
    isRuleSet(node) ? compileSegmentRules(node, catalog, now) : compileRule(node, catalog, now),
  );
  return Prisma.sql`(${Prisma.join(parts, ruleSet.combinator === 'and' ? ' AND ' : ' OR ')})`;
}
