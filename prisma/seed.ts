/**
 * Datos iniciales de desarrollo (idempotente): super-administrador y dos tenants.
 * - MCSupport: tenant de demostración que se irá completando en cada fase.
 * - MCLog: tenant vacío para probar el asistente de configuración.
 *
 * La contraseña del administrador se define en la Fase 1 (autenticación); hasta entonces
 * el usuario existe sin credenciales.
 * Autor: Ing. Heri Espinosa
 */
import { z } from 'zod';
import { createPrismaClient } from '../src/infrastructure/persistence/prisma/client';

const seedEnv = z
  .object({
    DATABASE_URL: z.string().min(1),
    SEED_ADMIN_EMAIL: z.email().default('admin@multicomputos.com'),
    SEED_ADMIN_NAME: z.string().min(1).default('Administrador de la plataforma'),
  })
  .parse(process.env);

const MULTICOMPUTOS_BRANDING = {
  primary: '#005E7D',
  accent: '#EBAD39',
  logoKey: null,
  footerMd: 'Multicómputos, optimizando el futuro juntos.',
};

const MULTICOMPUTOS_ADDRESS = 'Av. Abraham Lincoln 1007, Santo Domingo, D.N., República Dominicana';

const TENANTS = [
  { slug: 'mcsupport', name: 'MCSupport', onboardingStep: 5 },
  { slug: 'mclog', name: 'MCLog', onboardingStep: 0 },
] as const;

async function main(): Promise<void> {
  const prisma = createPrismaClient(seedEnv.DATABASE_URL);
  try {
    const admin = await prisma.user.upsert({
      where: { email: seedEnv.SEED_ADMIN_EMAIL },
      update: {},
      create: {
        email: seedEnv.SEED_ADMIN_EMAIL,
        name: seedEnv.SEED_ADMIN_NAME,
        platformRole: 'SUPER_ADMIN',
      },
    });

    for (const tenantSeed of TENANTS) {
      const tenant = await prisma.tenant.upsert({
        where: { slug: tenantSeed.slug },
        update: {},
        create: {
          slug: tenantSeed.slug,
          name: tenantSeed.name,
          branding: MULTICOMPUTOS_BRANDING,
          postalAddress: MULTICOMPUTOS_ADDRESS,
          onboardingStep: tenantSeed.onboardingStep,
        },
      });
      await prisma.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: admin.id } },
        update: {},
        create: { tenantId: tenant.id, userId: admin.id, role: 'OWNER' },
      });
    }

    console.log(`Seed aplicado: administrador y ${TENANTS.length} tenants.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('El seed falló:', error);
  process.exit(1);
});
