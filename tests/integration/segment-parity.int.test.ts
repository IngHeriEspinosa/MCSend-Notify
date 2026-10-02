/**
 * Paridad entre el compilador SQL de segmentos y el evaluador de referencia del dominio:
 * para cada conjunto de reglas, PostgreSQL debe devolver exactamente los mismos contactos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContactFieldDefinition } from '@/core/contacts/contact-fields';
import {
  buildSegmentCatalog,
  evaluateSegment,
  validateSegmentRules,
  type SegmentRuleSet,
  type SegmentSubject,
} from '@/core/contacts/segments';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  PrismaContactFieldRepository,
  PrismaContactListRepository,
  PrismaTagRepository,
} from '@/infrastructure/persistence/prisma/repositories/audience.prisma-repositories';
import { PrismaContactRepository } from '@/infrastructure/persistence/prisma/repositories/contact.prisma-repository';
import { createTestPrisma, createTestTenant } from './helpers';

const { prisma, clients } = createTestPrisma();
const contactsRepo = new PrismaContactRepository(prisma, clients);
const NOW = new Date('2026-10-02T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

let context: TenantContext;
let fields: ContactFieldDefinition[];
let listId: string;
let tagId: string;
const subjects = new Map<string, SegmentSubject>();

beforeAll(async () => {
  context = await createTestTenant(prisma, 'seg');
  const fieldRepo = new PrismaContactFieldRepository(clients);
  await fieldRepo.create(context, {
    key: 'country',
    label: 'País',
    type: 'SELECT',
    options: ['DO', 'GT', 'PR'],
  });
  await fieldRepo.create(context, {
    key: 'seats',
    label: 'Licencias',
    type: 'NUMBER',
    options: [],
  });
  await fieldRepo.create(context, {
    key: 'renewal',
    label: 'Renovación',
    type: 'DATE',
    options: [],
  });
  await fieldRepo.create(context, { key: 'vip', label: 'VIP', type: 'BOOLEAN', options: [] });
  await fieldRepo.create(context, { key: 'plan', label: 'Plan', type: 'STRING', options: [] });
  fields = await fieldRepo.list(context);
  listId = (
    await new PrismaContactListRepository(clients).create(context, {
      name: 'Lista',
      description: null,
    })
  ).id;
  tagId = (await new PrismaTagRepository(clients).create(context, { name: 'Partner', color: null }))
    .id;

  const countries = ['DO', 'GT', 'PR', undefined];
  const companies = ['Banco Popular', 'Claro', null, '100% Digital_SA', ''];
  for (let index = 0; index < 40; index += 1) {
    const attributes: Record<string, string | number | boolean> = {};
    const country = countries[index % countries.length];
    if (country) attributes.country = country;
    if (index % 3 !== 0) attributes.seats = (index * 7) % 50;
    if (index % 4 !== 1)
      attributes.renewal = new Date(NOW.getTime() + (index - 20) * 5 * DAY)
        .toISOString()
        .slice(0, 10);
    if (index % 5 === 0) attributes.vip = true;
    if (index % 5 === 1) attributes.vip = false;
    if (index % 2 === 0) attributes.plan = index % 4 === 0 ? 'Enterprise' : 'Pyme';

    const createdAt = new Date(NOW.getTime() - index * 2 * DAY - 3600_000);
    const email = `contacto${index}@Cliente${index % 3}.com`;
    const contact = await prisma.contact.create({
      data: {
        tenantId: context.tenantId,
        email,
        emailNormalized: email.toLowerCase(),
        firstName: index % 6 === 0 ? null : `Nombre${index}`,
        company: companies[index % companies.length] ?? null,
        locale: index % 2 === 0 ? 'es' : index % 3 === 0 ? 'en' : null,
        status: index % 7 === 0 ? 'UNSUBSCRIBED' : 'ACTIVE',
        attributes,
        createdAt,
        lastEngagedAt: index % 3 === 0 ? null : new Date(NOW.getTime() - index * DAY),
      },
    });
    const inList = index % 2 === 1;
    const tagged = index % 5 === 2;
    if (inList)
      await prisma.listMembership.create({
        data: { tenantId: context.tenantId, listId, contactId: contact.id },
      });
    if (tagged)
      await prisma.contactTag.create({
        data: { tenantId: context.tenantId, tagId, contactId: contact.id },
      });
    subjects.set(contact.id, {
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      locale: contact.locale,
      status: contact.status,
      createdAt: contact.createdAt,
      lastEngagedAt: contact.lastEngagedAt,
      attributes,
      listIds: inList ? [listId] : [],
      tagIds: tagged ? [tagId] : [],
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

const rule = (field: string, operator: string, value?: unknown) =>
  ({ combinator: 'and', rules: [{ field, operator, value }] }) as SegmentRuleSet;

const cases: Array<[string, () => SegmentRuleSet]> = [
  ['email contiene', () => rule('email', 'contains', 'CLIENTE1')],
  ['email es igual', () => rule('email', 'equals', 'contacto3@cliente0.com')],
  ['empresa contiene comodines literales', () => rule('company', 'contains', '100%')],
  ['empresa contiene guion bajo literal', () => rule('company', 'contains', 'l_S')],
  ['empresa empieza por', () => rule('company', 'startsWith', 'banco')],
  ['empresa no contiene', () => rule('company', 'notContains', 'claro')],
  ['empresa vacía', () => rule('company', 'isEmpty')],
  ['nombre no vacío', () => rule('firstName', 'isNotEmpty')],
  ['nombre distinto (incluye vacíos)', () => rule('firstName', 'notEquals', 'Nombre5')],
  ['idioma en lista', () => rule('locale', 'in', ['en'])],
  ['idioma fuera de lista', () => rule('locale', 'notIn', ['es'])],
  ['estado igual', () => rule('status', 'equals', 'UNSUBSCRIBED')],
  ['alta antes de', () => rule('createdAt', 'before', '2026-09-20')],
  ['alta después de', () => rule('createdAt', 'after', '2026-09-20')],
  ['alta en últimos días', () => rule('createdAt', 'inLastDays', 15)],
  ['sin interacción reciente', () => rule('lastEngagedAt', 'notInLastDays', 10)],
  ['interacción vacía', () => rule('lastEngagedAt', 'isEmpty')],
  ['país igual', () => rule('attr.country', 'equals', 'DO')],
  ['país distinto', () => rule('attr.country', 'notEquals', 'DO')],
  ['país en lista', () => rule('attr.country', 'in', ['GT', 'PR'])],
  ['país vacío', () => rule('attr.country', 'isEmpty')],
  ['licencias mayor que', () => rule('attr.seats', 'gt', 20)],
  ['licencias menor o igual', () => rule('attr.seats', 'lte', 14)],
  ['licencias distinto (incluye vacíos)', () => rule('attr.seats', 'notEquals', 14)],
  ['licencias vacías', () => rule('attr.seats', 'isEmpty')],
  ['renovación antes de', () => rule('attr.renewal', 'before', '2026-10-02')],
  ['renovación después de', () => rule('attr.renewal', 'after', '2026-10-02')],
  ['renovación en últimos días', () => rule('attr.renewal', 'inLastDays', 30)],
  ['renovación vacía', () => rule('attr.renewal', 'isEmpty')],
  ['vip verdadero', () => rule('attr.vip', 'isTrue')],
  ['vip falso (incluye vacíos)', () => rule('attr.vip', 'isFalse')],
  ['plan igual sin mayúsculas', () => rule('attr.plan', 'equals', 'enterprise')],
  ['en lista', () => rule('list', 'inList', listId)],
  ['fuera de lista', () => rule('list', 'notInList', listId)],
  ['con etiqueta', () => rule('tag', 'hasTag', tagId)],
  ['sin etiqueta', () => rule('tag', 'notHasTag', tagId)],
  [
    'combinación anidada',
    () => ({
      combinator: 'and',
      rules: [
        { field: 'status', operator: 'equals', value: 'ACTIVE' },
        {
          combinator: 'or',
          rules: [
            { field: 'attr.country', operator: 'in', value: ['DO', 'PR'] },
            { field: 'attr.seats', operator: 'gte', value: 30 },
          ],
        },
        { field: 'list', operator: 'notInList', value: listId },
      ],
    }),
  ],
];

describe('paridad SQL ↔ evaluador de segmentos', () => {
  it.each(cases)('%s', async (_name, build) => {
    const ruleSet = build();
    const catalog = buildSegmentCatalog(fields);
    validateSegmentRules(ruleSet, catalog);

    const expected = [...subjects.entries()]
      .filter(([, subject]) => evaluateSegment(ruleSet, catalog, subject, NOW))
      .map(([id]) => id)
      .sort();

    const segment = { rules: ruleSet, catalog, now: NOW };
    const page = await contactsRepo.list(
      context,
      { sortField: 'createdAt', sortDirection: 'desc', page: 0, pageSize: 100 },
      segment,
    );
    expect(page.items.map((item) => item.id).sort()).toEqual(expected);
    expect(await contactsRepo.count(context, segment)).toBe(expected.length);
  });
});
