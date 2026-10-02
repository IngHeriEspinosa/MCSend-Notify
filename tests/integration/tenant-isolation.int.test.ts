/**
 * Aislamiento entre tenants contra PostgreSQL real: ningún repositorio puede leer, modificar
 * ni relacionar datos de otro tenant aunque conozca sus identificadores (IDOR).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@/core/shared/tenant-context';
import { PrismaContactListRepository } from '@/infrastructure/persistence/prisma/repositories/audience.prisma-repositories';
import { PrismaContactRepository } from '@/infrastructure/persistence/prisma/repositories/contact.prisma-repository';
import { TenantScopeViolationError } from '@/infrastructure/persistence/prisma/tenant-scope.extension';
import { createTestPrisma, createTestTenant } from './helpers';

const { prisma, clients } = createTestPrisma();
const contacts = new PrismaContactRepository(prisma, clients);
const lists = new PrismaContactListRepository(clients);

let tenantA: TenantContext;
let tenantB: TenantContext;
let contactA: string;
let listA: string;

beforeAll(async () => {
  tenantA = await createTestTenant(prisma, 'iso-a');
  tenantB = await createTestTenant(prisma, 'iso-b');
  const created = await contacts.create(
    tenantA,
    {
      email: 'ana@cliente.com',
      emailNormalized: 'ana@cliente.com',
      attributes: {},
      source: 'manual',
    },
    {},
  );
  contactA = created.id;
  listA = (await lists.create(tenantA, { name: 'Clientes', description: null })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('aislamiento por tenant', () => {
  it('otro tenant no encuentra el contacto por id', async () => {
    expect(await contacts.findById(tenantB, contactA)).toBeNull();
    expect(await contacts.findById(tenantA, contactA)).not.toBeNull();
  });

  it('otro tenant no puede borrarlo ni modificarlo', async () => {
    expect(await contacts.delete(tenantB, contactA)).toBe(false);
    await expect(
      contacts.update(
        tenantB,
        contactA,
        { email: 'x@y.com', emailNormalized: 'x@y.com', attributes: {} },
        {},
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await contacts.findById(tenantA, contactA))?.email).toBe('ana@cliente.com');
  });

  it('las listas de otro tenant no existen para la validación de referencias', async () => {
    expect(await lists.countExisting(tenantB, [listA])).toBe(0);
    expect(await lists.countExisting(tenantA, [listA])).toBe(1);
  });

  it('no se pueden añadir contactos de otro tenant a una lista', async () => {
    const listB = await lists.create(tenantB, { name: 'Ajena', description: null });
    expect(await lists.addContacts(tenantB, listB.id, [contactA], 'manual')).toBe(0);
  });

  it('el cliente acotado rechaza escrituras que apunten a otro tenant', async () => {
    const scoped = clients.forTenant(tenantB.tenantId);
    await expect(
      scoped.contact.create({
        data: { tenantId: tenantA.tenantId, email: 'z@z.com', emailNormalized: 'z@z.com' },
      }),
    ).rejects.toBeInstanceOf(TenantScopeViolationError);
    expect(await scoped.contact.count({ where: { id: contactA } })).toBe(0);
  });

  it('el filtro de tenant también se aplica dentro de transacciones interactivas', async () => {
    const found = await clients
      .forTenant(tenantB.tenantId)
      .$transaction((tx) => tx.contact.findFirst({ where: { id: contactA } }));
    expect(found).toBeNull();
  });

  it('el email es único por tenant, no globalmente', async () => {
    const sameEmail = await contacts.create(
      tenantB,
      { email: 'ana@cliente.com', emailNormalized: 'ana@cliente.com', attributes: {} },
      {},
    );
    expect(sameEmail.id).not.toBe(contactA);
    await expect(
      contacts.create(
        tenantB,
        { email: 'ANA@cliente.com', emailNormalized: 'ana@cliente.com', attributes: {} },
        {},
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { field: 'email' } });
  });
});
