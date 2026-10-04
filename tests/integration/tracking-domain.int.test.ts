/**
 * Dominio de seguimiento contra PostgreSQL real: unicidad entre tenants, verificación (con su
 * fecha original), retirada y consulta para el TLS bajo demanda.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@/core/shared/tenant-context';
import { PrismaTrackingDomainRepository } from '@/infrastructure/persistence/prisma/repositories/tracking-domain.prisma-repository';
import { createTestPrisma, createTestTenant } from './helpers';

const { prisma } = createTestPrisma();
const repository = new PrismaTrackingDomainRepository(prisma);

let tenant: TenantContext;
let other: TenantContext;
const domain = `clic-${randomUUID().slice(0, 8)}.ejemplo.com`;

beforeAll(async () => {
  tenant = await createTestTenant(prisma, 'td-a');
  other = await createTestTenant(prisma, 'td-b');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaTrackingDomainRepository', () => {
  it('un dominio solo puede pertenecer a un tenant', async () => {
    expect(await repository.set(tenant, domain)).toBe(true);
    expect(await repository.set(other, domain)).toBe(false);
    expect(await repository.get(other)).toBeNull();
    expect(await repository.get(tenant)).toMatchObject({ domain, verifiedAt: null, error: null });
  });

  it('registra la verificación conservando la primera fecha y la retira si falla', async () => {
    const first = new Date('2026-10-01T10:00:00Z');
    await repository.recordCheck(tenant, { verified: true, at: first, error: null });
    await repository.recordCheck(tenant, {
      verified: true,
      at: new Date('2026-10-02T10:00:00Z'),
      error: null,
    });
    expect(await repository.get(tenant)).toMatchObject({
      verifiedAt: first,
      checkedAt: new Date('2026-10-02T10:00:00Z'),
    });
    expect(await repository.isVerified(domain)).toBe(true);
    expect(await repository.verifiedDomains()).toContainEqual({
      tenantId: tenant.tenantId,
      domain,
    });
    expect(await repository.listConfigured()).toContainEqual({
      tenantId: tenant.tenantId,
      tenantSlug: tenant.tenantSlug,
      domain,
    });

    await repository.recordCheck(tenant, {
      verified: false,
      at: new Date('2026-10-03T10:00:00Z'),
      error: 'CNAME_MISSING',
    });
    expect(await repository.get(tenant)).toMatchObject({
      verifiedAt: null,
      error: 'CNAME_MISSING',
    });
    expect(await repository.isVerified(domain)).toBe(false);
  });

  it('un tenant suspendido no obtiene certificados y quitar el dominio lo libera', async () => {
    await repository.recordCheck(tenant, { verified: true, at: new Date(), error: null });
    await prisma.tenant.update({ where: { id: tenant.tenantId }, data: { status: 'SUSPENDED' } });
    expect(await repository.isVerified(domain)).toBe(false);
    await prisma.tenant.update({ where: { id: tenant.tenantId }, data: { status: 'ACTIVE' } });

    expect(await repository.set(tenant, null)).toBe(true);
    expect(await repository.get(tenant)).toBeNull();
    expect(await repository.set(other, domain)).toBe(true);
  });
});
