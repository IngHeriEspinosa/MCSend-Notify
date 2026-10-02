/**
 * Alta o actualización de contactos por email (API pública) con repositorios reales:
 * los campos ausentes conservan su valor, las listas se suman y el estado no cambia.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemClock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  UpsertContactUseCase,
  type ContactUseCaseDeps,
} from '@/core/contacts/use-cases/contacts.use-cases';
import { contactInputSchema } from '@/core/contacts/contact';
import {
  PrismaContactFieldRepository,
  PrismaContactListRepository,
  PrismaSegmentRepository,
  PrismaTagRepository,
  PrismaTopicRepository,
} from '@/infrastructure/persistence/prisma/repositories/audience.prisma-repositories';
import { PrismaContactRepository } from '@/infrastructure/persistence/prisma/repositories/contact.prisma-repository';
import { RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import { createTestPrisma, createTestTenant } from './helpers';

const { prisma, clients } = createTestPrisma();
const deps: ContactUseCaseDeps = {
  contacts: new PrismaContactRepository(prisma, clients),
  fields: new PrismaContactFieldRepository(clients),
  lists: new PrismaContactListRepository(clients),
  tags: new PrismaTagRepository(clients),
  topics: new PrismaTopicRepository(clients),
  segments: new PrismaSegmentRepository(clients),
  audit: new RecordingAuditLogger(),
  clock: systemClock,
};
const upsert = new UpsertContactUseCase(deps);

let context: TenantContext;
let listA: string;
let listB: string;

beforeAll(async () => {
  const owner = await createTestTenant(prisma, 'api');
  context = { ...owner, actor: { type: 'apiKey', apiKeyId: 'k-test', scopes: ['contacts:write'] } };
  await deps.fields.create(owner, { key: 'plan', label: 'Plan', type: 'STRING', options: [] });
  await deps.fields.create(owner, {
    key: 'seats',
    label: 'Licencias',
    type: 'NUMBER',
    options: [],
  });
  listA = (await deps.lists.create(owner, { name: 'A', description: null })).id;
  listB = (await deps.lists.create(owner, { name: 'B', description: null })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('UpsertContactUseCase', () => {
  it('crea el contacto con origen api', async () => {
    const result = await upsert.execute(
      context,
      contactInputSchema.parse({
        email: 'Cliente@Api.com',
        firstName: 'Ana',
        company: 'Banco',
        attributes: { plan: 'Pyme', seats: 5 },
        listIds: [listA],
      }),
    );
    expect(result.created).toBe(true);
    expect(result.contact).toMatchObject({ source: 'api', firstName: 'Ana', listIds: [listA] });
  });

  it('conserva los campos omitidos, fusiona atributos y suma listas', async () => {
    await prisma.contact.updateMany({
      where: { tenantId: context.tenantId, emailNormalized: 'cliente@api.com' },
      data: { status: 'UNSUBSCRIBED' },
    });
    const result = await upsert.execute(
      context,
      contactInputSchema.parse({
        email: 'cliente@api.com',
        lastName: 'Pérez',
        attributes: { seats: 9 },
        listIds: [listB],
      }),
    );
    expect(result.created).toBe(false);
    expect(result.contact).toMatchObject({
      firstName: 'Ana',
      lastName: 'Pérez',
      company: 'Banco',
      status: 'UNSUBSCRIBED',
      attributes: { plan: 'Pyme', seats: 9 },
    });
    expect([...result.contact.listIds].sort()).toEqual([listA, listB].sort());
  });

  it('rechaza atributos desconocidos y una clave sin permiso de escritura', async () => {
    await expect(
      upsert.execute(
        context,
        contactInputSchema.parse({ email: 'x@api.com', attributes: { inexistente: 1 } }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      upsert.execute(
        { ...context, actor: { type: 'apiKey', apiKeyId: 'k-ro', scopes: ['contacts:read'] } },
        contactInputSchema.parse({ email: 'y@api.com' }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
