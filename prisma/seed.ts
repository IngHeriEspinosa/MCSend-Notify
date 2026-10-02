/**
 * Datos iniciales de desarrollo (idempotente: se puede ejecutar varias veces).
 * - Super-administrador con la contraseña SEED_ADMIN_PASSWORD (solo si aún no tiene una).
 * - MCSupport: tenant de demostración con campos, temas, listas, etiquetas, contactos y segmentos.
 * - MCLog: tenant vacío para probar la configuración desde cero.
 * Autor: Ing. Heri Espinosa
 */
import { z } from 'zod';
import { Argon2PasswordHasher } from '../src/infrastructure/crypto/crypto-services';
import {
  createPrismaClient,
  type PrismaClient,
} from '../src/infrastructure/persistence/prisma/client';

const seedEnv = z
  .object({
    DATABASE_URL: z.string().min(1),
    SEED_ADMIN_EMAIL: z.email().default('admin@multicomputos.com'),
    SEED_ADMIN_NAME: z.string().min(1).default('Administrador de la plataforma'),
    SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  })
  .parse(process.env);

const MULTICOMPUTOS_BRANDING = {
  primary: '#005E7D',
  accent: '#EBAD39',
  logoKey: null,
  footerMd: 'Multicómputos, optimizando el futuro juntos.',
};

const MULTICOMPUTOS_ADDRESS = 'Av. Abraham Lincoln 1007, Santo Domingo, D.N., República Dominicana';

const COUNTRIES = ['DO', 'GT', 'PR', 'SV', 'CR', 'PA', 'HN', 'EC'];
const PLANS = ['Básico', 'Profesional', 'Enterprise'];
const COMPANIES = [
  'Banco Popular',
  'Grupo Ramos',
  'Claro Centroamérica',
  'Universidad APEC',
  'Ministerio de Hacienda',
  'Seguros Universal',
  'Farmacia Carol',
  'Hospital Metropolitano',
];
const FIRST_NAMES = [
  'Ana',
  'Luis',
  'María',
  'José',
  'Carmen',
  'Pedro',
  'Laura',
  'Miguel',
  'Sofía',
  'Jorge',
];
const LAST_NAMES = [
  'Pérez',
  'Rodríguez',
  'Gómez',
  'Martínez',
  'Fernández',
  'López',
  'Díaz',
  'Santos',
];

async function upsertTenant(
  prisma: PrismaClient,
  slug: string,
  name: string,
  onboardingStep: number,
) {
  return prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name,
      branding: MULTICOMPUTOS_BRANDING,
      postalAddress: MULTICOMPUTOS_ADDRESS,
      onboardingStep,
    },
  });
}

async function seedDemoAudience(prisma: PrismaClient, tenantId: string) {
  const fields = [
    { key: 'country', label: 'País', type: 'SELECT' as const, options: COUNTRIES },
    { key: 'plan', label: 'Plan contratado', type: 'SELECT' as const, options: PLANS },
    { key: 'seats', label: 'Licencias', type: 'NUMBER' as const, options: [] },
    { key: 'renewal', label: 'Fecha de renovación', type: 'DATE' as const, options: [] },
    { key: 'vip', label: 'Cliente VIP', type: 'BOOLEAN' as const, options: [] },
  ];
  for (const field of fields) {
    await prisma.contactField.upsert({
      where: { tenantId_key: { tenantId, key: field.key } },
      update: {},
      create: { tenantId, ...field },
    });
  }

  const topics = [
    { key: 'product_updates', name: { es: 'Actualizaciones de producto', en: 'Product updates' } },
    { key: 'weekly_digest', name: { es: 'Resumen semanal', en: 'Weekly digest' } },
  ];
  for (const topic of topics) {
    await prisma.topic.upsert({
      where: { tenantId_key: { tenantId, key: topic.key } },
      update: {},
      create: { tenantId, ...topic, description: {}, isDefault: true },
    });
  }

  const customers = await prisma.contactList.upsert({
    where: { tenantId_name: { tenantId, name: 'Clientes activos' } },
    update: {},
    create: {
      tenantId,
      name: 'Clientes activos',
      description: 'Clientes con contrato vigente de MCSupport.',
    },
  });
  const beta = await prisma.contactList.upsert({
    where: { tenantId_name: { tenantId, name: 'Beta testers' } },
    update: {},
    create: { tenantId, name: 'Beta testers', description: 'Reciben las versiones preliminares.' },
  });
  const partner = await prisma.tag.upsert({
    where: { tenantId_name: { tenantId, name: 'Partner' } },
    update: {},
    create: { tenantId, name: 'Partner', color: '#005E7D' },
  });
  await prisma.tag.upsert({
    where: { tenantId_name: { tenantId, name: 'Gobierno' } },
    update: {},
    create: { tenantId, name: 'Gobierno', color: '#EBAD39' },
  });

  const now = Date.now();
  for (let index = 0; index < 25; index += 1) {
    const firstName = FIRST_NAMES[index % FIRST_NAMES.length] ?? 'Ana';
    const lastName = LAST_NAMES[index % LAST_NAMES.length] ?? 'Pérez';
    const email = `${firstName}.${lastName}${index}@cliente.example`
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    const renewal = new Date(now + (index * 11 - 60) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const contact = await prisma.contact.upsert({
      where: { tenantId_emailNormalized: { tenantId, emailNormalized: email } },
      update: {},
      create: {
        tenantId,
        email,
        emailNormalized: email,
        firstName,
        lastName,
        company: COMPANIES[index % COMPANIES.length] ?? null,
        locale: index % 4 === 0 ? 'en' : 'es',
        status: index % 9 === 8 ? 'UNSUBSCRIBED' : 'ACTIVE',
        source: 'manual',
        consentAt: new Date(now - index * 86_400_000),
        consentSource: 'Datos de demostración',
        attributes: {
          country: COUNTRIES[index % COUNTRIES.length] ?? 'DO',
          plan: PLANS[index % PLANS.length] ?? 'Básico',
          seats: 5 + ((index * 7) % 60),
          renewal,
          vip: index % 5 === 0,
        },
      },
    });
    if (index % 9 !== 8) {
      await prisma.listMembership.upsert({
        where: { listId_contactId: { listId: customers.id, contactId: contact.id } },
        update: {},
        create: { tenantId, listId: customers.id, contactId: contact.id },
      });
    }
    if (index % 3 === 0) {
      await prisma.listMembership.upsert({
        where: { listId_contactId: { listId: beta.id, contactId: contact.id } },
        update: {},
        create: { tenantId, listId: beta.id, contactId: contact.id },
      });
    }
    if (index % 6 === 0) {
      await prisma.contactTag.upsert({
        where: { contactId_tagId: { contactId: contact.id, tagId: partner.id } },
        update: {},
        create: { tenantId, contactId: contact.id, tagId: partner.id },
      });
    }
  }

  const segments = [
    {
      name: 'Enterprise en República Dominicana',
      description: 'Clientes del plan Enterprise con sede en RD.',
      rules: {
        combinator: 'and',
        rules: [
          { field: 'attr.country', operator: 'equals', value: 'DO' },
          { field: 'attr.plan', operator: 'equals', value: 'Enterprise' },
        ],
      },
    },
    {
      name: 'Clientes VIP activos',
      description: 'Contactos VIP con estado activo.',
      rules: {
        combinator: 'and',
        rules: [
          { field: 'attr.vip', operator: 'isTrue' },
          { field: 'status', operator: 'equals', value: 'ACTIVE' },
        ],
      },
    },
  ];
  for (const segment of segments) {
    await prisma.segment.upsert({
      where: { tenantId_name: { tenantId, name: segment.name } },
      update: {},
      create: { tenantId, ...segment },
    });
  }
}

async function main(): Promise<void> {
  const prisma = createPrismaClient(seedEnv.DATABASE_URL);
  try {
    const existing = await prisma.user.findUnique({ where: { email: seedEnv.SEED_ADMIN_EMAIL } });
    const passwordHash =
      !existing?.passwordHash && seedEnv.SEED_ADMIN_PASSWORD
        ? await new Argon2PasswordHasher().hash(seedEnv.SEED_ADMIN_PASSWORD)
        : undefined;
    const admin = await prisma.user.upsert({
      where: { email: seedEnv.SEED_ADMIN_EMAIL },
      update: passwordHash ? { passwordHash } : {},
      create: {
        email: seedEnv.SEED_ADMIN_EMAIL,
        name: seedEnv.SEED_ADMIN_NAME,
        platformRole: 'SUPER_ADMIN',
        ...(passwordHash ? { passwordHash } : {}),
      },
    });

    const mcsupport = await upsertTenant(prisma, 'mcsupport', 'MCSupport', 5);
    const mclog = await upsertTenant(prisma, 'mclog', 'MCLog', 0);
    for (const tenant of [mcsupport, mclog]) {
      await prisma.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: admin.id } },
        update: {},
        create: { tenantId: tenant.id, userId: admin.id, role: 'OWNER' },
      });
    }
    await seedDemoAudience(prisma, mcsupport.id);

    console.log(
      `Seed aplicado: administrador${passwordHash ? ' (contraseña inicial asignada)' : ''}, MCSupport con datos de demostración y MCLog vacío.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('El seed falló:', error);
  process.exit(1);
});
