import { describe, expect, it } from 'vitest';
import { DomainError } from '@/core/shared/domain-error';
import type { ContactFieldDefinition } from './contact-fields';
import {
  buildSegmentCatalog,
  evaluateSegment,
  segmentRuleSetSchema,
  validateSegmentRules,
  type SegmentRuleSet,
  type SegmentSubject,
} from './segments';

const FIELDS: ContactFieldDefinition[] = [
  { id: 'f1', key: 'country', label: 'País', type: 'SELECT', options: ['DO', 'GT', 'PR'] },
  { id: 'f2', key: 'seats', label: 'Licencias', type: 'NUMBER', options: [] },
  { id: 'f3', key: 'renewal', label: 'Renovación', type: 'DATE', options: [] },
  { id: 'f4', key: 'vip', label: 'VIP', type: 'BOOLEAN', options: [] },
];
const catalog = buildSegmentCatalog(FIELDS);
const NOW = new Date('2026-10-02T12:00:00.000Z');
const LIST_ID = '0199a1b2-0000-7000-8000-000000000001';

function subject(overrides: Partial<SegmentSubject> = {}): SegmentSubject {
  return {
    email: 'ana@cliente.com',
    firstName: 'Ana',
    lastName: null,
    company: 'Banco Popular',
    locale: 'es',
    status: 'ACTIVE',
    createdAt: new Date('2026-09-30T08:00:00.000Z'),
    lastEngagedAt: null,
    attributes: { country: 'DO', seats: 25, renewal: '2026-12-01', vip: true },
    listIds: [LIST_ID],
    tagIds: [],
    ...overrides,
  };
}

describe('validateSegmentRules', () => {
  it('acepta reglas válidas anidadas', () => {
    const rules: SegmentRuleSet = {
      combinator: 'and',
      rules: [
        { field: 'attr.country', operator: 'in', value: ['DO', 'PR'] },
        { combinator: 'or', rules: [{ field: 'attr.seats', operator: 'gte', value: 10 }] },
      ],
    };
    expect(() => validateSegmentRules(segmentRuleSetSchema.parse(rules), catalog)).not.toThrow();
  });

  it.each([
    [{ field: 'attr.desconocido', operator: 'equals', value: 'x' }, 'UNKNOWN_FIELD'],
    [{ field: 'attr.seats', operator: 'contains', value: '1' }, 'INVALID_OPERATOR'],
    [{ field: 'attr.seats', operator: 'gt', value: '10' }, 'NUMBER_REQUIRED'],
    [{ field: 'attr.country', operator: 'equals', value: 'MX' }, 'INVALID_OPTION'],
    [{ field: 'createdAt', operator: 'before', value: '02/10/2026' }, 'DATE_REQUIRED'],
    [{ field: 'list', operator: 'inList', value: 'no-es-un-uuid' }, 'ID_REQUIRED'],
  ])('rechaza %j con %s', (rule, reason) => {
    const ruleSet = { combinator: 'and', rules: [rule] } as SegmentRuleSet;
    try {
      validateSegmentRules(ruleSet, catalog);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).details?.reason).toBe(reason);
    }
  });

  it('limita la profundidad de anidamiento', () => {
    const deep: SegmentRuleSet = {
      combinator: 'and',
      rules: [
        {
          combinator: 'or',
          rules: [
            {
              combinator: 'and',
              rules: [{ combinator: 'or', rules: [{ field: 'email', operator: 'isEmpty' }] }],
            },
          ],
        },
      ],
    };
    expect(() => validateSegmentRules(deep, catalog)).toThrow(/TOO_DEEP/);
  });
});

describe('evaluateSegment', () => {
  const check = (rules: SegmentRuleSet, overrides?: Partial<SegmentSubject>) =>
    evaluateSegment(rules, catalog, subject(overrides), NOW);
  const one = (field: string, operator: string, value?: unknown) =>
    ({ combinator: 'and', rules: [{ field, operator, value }] }) as SegmentRuleSet;

  it('texto sin distinguir mayúsculas', () => {
    expect(check(one('company', 'contains', 'popular'))).toBe(true);
    expect(check(one('email', 'equals', 'ANA@CLIENTE.COM'))).toBe(true);
    expect(check(one('company', 'startsWith', 'banco'))).toBe(true);
  });

  it('los vacíos cuentan como "" y "no es igual" los incluye', () => {
    expect(check(one('lastName', 'isEmpty'))).toBe(true);
    expect(check(one('lastName', 'notEquals', 'Pérez'))).toBe(true);
  });

  it('números, fechas y booleanos en atributos', () => {
    expect(check(one('attr.seats', 'gt', 20))).toBe(true);
    expect(check(one('attr.seats', 'lt', 20))).toBe(false);
    expect(check(one('attr.renewal', 'after', '2026-11-30'))).toBe(true);
    expect(check(one('attr.vip', 'isTrue'))).toBe(true);
    expect(check(one('attr.vip', 'isFalse'), { attributes: {} })).toBe(true);
  });

  it('fechas de columna por día UTC y ventanas relativas', () => {
    expect(check(one('createdAt', 'inLastDays', 7))).toBe(true);
    expect(check(one('createdAt', 'before', '2026-09-30'))).toBe(false);
    expect(check(one('lastEngagedAt', 'notInLastDays', 30))).toBe(true);
  });

  it('pertenencia a listas y combinadores', () => {
    expect(check(one('list', 'inList', LIST_ID))).toBe(true);
    expect(
      check({
        combinator: 'or',
        rules: [
          { field: 'attr.country', operator: 'equals', value: 'GT' },
          { field: 'status', operator: 'equals', value: 'ACTIVE' },
        ],
      }),
    ).toBe(true);
    expect(
      check({
        combinator: 'and',
        rules: [
          { field: 'attr.country', operator: 'equals', value: 'GT' },
          { field: 'status', operator: 'equals', value: 'ACTIVE' },
        ],
      }),
    ).toBe(false);
  });
});
