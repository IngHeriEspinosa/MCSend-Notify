/** Utilidades de los tests de integración: cliente Prisma de tests y tenants aislados por test. */
import { randomUUID } from 'node:crypto';
import type { TenantContext } from '@/core/shared/tenant-context';
import { createPrismaClient, type PrismaClient } from '@/infrastructure/persistence/prisma/client';
import { TenantClientCache } from '@/infrastructure/persistence/prisma/tenant-scope.extension';

export function createTestPrisma(): { prisma: PrismaClient; clients: TenantClientCache } {
  const url = process.env.TEST_DATABASE_URL;
  if (!url)
    throw new Error('Falta TEST_DATABASE_URL (lo define tests/integration/global-setup.ts)');
  const prisma = createPrismaClient(url);
  return { prisma, clients: new TenantClientCache(prisma) };
}

/** Crea un tenant con slug único y devuelve un contexto de OWNER para usarlo en los casos de uso. */
export async function createTestTenant(
  prisma: PrismaClient,
  label = 'tenant',
): Promise<TenantContext> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  const user = await prisma.user.create({ data: { email: `${slug}@example.com` } });
  await prisma.tenantMembership.create({
    data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' },
  });
  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    actor: { type: 'user', userId: user.id, role: 'OWNER', isPlatformAdmin: false },
  };
}
