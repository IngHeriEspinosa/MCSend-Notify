/**
 * Datos iniciales de desarrollo (idempotente: se puede ejecutar varias veces).
 * - Super-administrador con la contraseña SEED_ADMIN_PASSWORD (solo si aún no tiene una).
 * - MCSupport: tenant de demostración con campos, temas, listas, etiquetas, contactos y segmentos.
 * - MCLog: tenant vacío para probar la configuración desde cero.
 * Autor: Ing. Heri Espinosa
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  parseEncryptionEnv,
  parseServerEnv,
  type EncryptionEnv,
  type ServerEnv,
} from '../src/common/config/env';
import { providerCredentialsAad } from '../src/core/providers/use-cases/providers.use-cases';
import { systemContext } from '../src/core/shared/tenant-context';
import { templateBodySchema } from '../src/core/templates/email-content';
import { AesGcmSecretCipher } from '../src/infrastructure/crypto/aes-gcm-secret-cipher';
import { Argon2PasswordHasher } from '../src/infrastructure/crypto/crypto-services';
import {
  createPrismaClient,
  type PrismaClient,
} from '../src/infrastructure/persistence/prisma/client';
import { createRedisConnection } from '../src/infrastructure/queue/connection';
import { BullDocumentQueue } from '../src/infrastructure/queue/jobs';
import { S3ObjectStorage } from '../src/infrastructure/storage/s3.object-storage';

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

const SAMPLE_DECK_FILE = 'sample-deck.pptx';

/**
 * Presentación de ejemplo: se sube al almacenamiento y se encola para que el worker genere la
 * miniatura. Si el almacenamiento o Redis no están configurados, se omite sin fallar.
 */
async function seedSampleDeck(
  prisma: PrismaClient,
  tenant: { id: string; slug: string },
  adminId: string,
): Promise<string | null> {
  const existing = await prisma.document.findFirst({
    where: { tenantId: tenant.id, fileName: SAMPLE_DECK_FILE },
    select: { id: true },
  });
  if (existing) return existing.id;

  let env: ServerEnv;
  try {
    env = parseServerEnv(process.env);
  } catch {
    console.warn(
      'Seed: sin variables de almacenamiento/Redis; se omite la presentación de ejemplo.',
    );
    return null;
  }
  const bytes = new Uint8Array(
    readFileSync(new URL(`./seed-assets/${SAMPLE_DECK_FILE}`, import.meta.url)),
  );
  const id = randomUUID();
  const storageKey = `tenants/${tenant.id}/documents/${id}/original.pptx`;
  const storage = new S3ObjectStorage({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  await storage.ensureBucket();
  await storage.put(
    storageKey,
    bytes,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  );
  await prisma.document.create({
    data: {
      id,
      tenantId: tenant.id,
      title: 'MCSupport 3.2 · Novedades',
      fileName: SAMPLE_DECK_FILE,
      extension: 'pptx',
      kind: 'PRESENTATION',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      storageKey,
      createdById: adminId,
    },
  });
  const redis = createRedisConnection(env.REDIS_URL, 'client');
  const queue = new BullDocumentQueue(redis);
  try {
    await queue.enqueue(systemContext(tenant.id, tenant.slug, 'seed'), id);
  } finally {
    await queue.close();
    await redis.quit();
  }
  return id;
}

/** Plantillas de ejemplo: actualización de producto (bloques) y resumen semanal (Markdown). */
async function seedDemoTemplates(
  prisma: PrismaClient,
  tenantId: string,
  adminId: string,
  deckId: string | null,
) {
  const productUpdate = templateBodySchema.parse({
    format: 'BLOCKS',
    subject: '{{ contact.first_name }}, ya está aquí MCSupport 3.2',
    preheader: 'Panel de SLA en tiempo real, asignación automática y más.',
    locale: 'es',
    content: {
      blocks: [
        { id: 'title', type: 'heading', text: 'Novedades de MCSupport 3.2', level: 1 },
        {
          id: 'intro',
          type: 'text',
          markdown:
            'Hola {{ contact.first_name }},\n\nEste mes llega **MCSupport 3.2** con mejoras pensadas para {{ contact.company | default: \"tu equipo\" }}:\n\n- Panel de SLA en tiempo real\n- Asignación automática de tickets por habilidades\n- Notificaciones en Microsoft Teams',
        },
        ...(deckId
          ? [
              {
                id: 'deck',
                type: 'document',
                documentId: deckId,
                description: 'Repasa todas las novedades en la presentación de la versión.',
              },
            ]
          : []),
        {
          id: 'cta',
          type: 'button',
          label: 'Conoce más',
          url: 'https://www.multicomputos.com',
        },
        { id: 'sep', type: 'divider' },
        {
          id: 'closing',
          type: 'text',
          markdown: 'Si tienes dudas, responde a este correo y nuestro equipo te ayudará.',
        },
      ],
    },
  });
  const weeklySummary = templateBodySchema.parse({
    format: 'MARKDOWN',
    subject: 'Resumen semanal de {{ tenant.name }}',
    preheader: 'Lo más importante de la semana en un minuto.',
    locale: 'es',
    content: {
      markdown:
        '# Resumen semanal\n\nHola {{ contact.first_name }}, esto es lo más destacado de la semana:\n\n## Novedades\n\n- Mejoras de rendimiento en la consola\n- Nuevos informes de satisfacción\n\n## Próximos pasos\n\nPlan contratado: **{{ fields.plan | default: "sin plan" }}**.\n\n[Gestiona tus preferencias]({{ preferences_url }})',
    },
  });

  for (const [name, description, body] of [
    [
      'Actualización de producto',
      'Anuncio de una versión nueva con su presentación.',
      productUpdate,
    ],
    ['Resumen semanal', 'Resumen de la semana en Markdown.', weeklySummary],
  ] as const) {
    const exists = await prisma.template.findUnique({
      where: { tenantId_name: { tenantId, name } },
      select: { id: true },
    });
    if (exists) continue;
    const columns = {
      format: body.format,
      subject: body.subject,
      preheader: body.preheader,
      locale: body.locale,
      content: body.content,
    };
    const template = await prisma.template.create({
      data: { tenantId, name, description, ...columns, createdById: adminId, updatedById: adminId },
    });
    await prisma.templateVersion.create({
      data: { tenantId, templateId: template.id, version: 1, ...columns, createdById: adminId },
    });
  }
}

/**
 * Envío de demostración: proveedor SMTP hacia Mailpit (credenciales cifradas como en producción),
 * remitente por defecto y una campaña en borrador dirigida a la lista "Clientes activos".
 * El host por defecto es `mailpit`, el nombre del servicio en la red de Docker del worker.
 */
async function seedDemoSending(prisma: PrismaClient, tenantId: string, adminId: string) {
  if (await prisma.emailProviderConfig.findFirst({ where: { tenantId }, select: { id: true } }))
    return;
  let encryption: EncryptionEnv;
  try {
    encryption = parseEncryptionEnv(process.env);
  } catch {
    console.warn('Seed: sin ENCRYPTION_KEYS; se omite el proveedor de demostración.');
    return;
  }
  const providerId = randomUUID();
  const cipher = new AesGcmSecretCipher(encryption.keys, encryption.activeKeyId);
  await prisma.emailProviderConfig.create({
    data: {
      id: providerId,
      tenantId,
      name: 'Mailpit (desarrollo)',
      kind: 'SMTP',
      settings: { host: process.env.SEED_SMTP_HOST ?? 'mailpit', port: 1025, security: 'none' },
      credentialsEnc: cipher.encrypt(
        JSON.stringify({ username: null, password: null }),
        providerCredentialsAad(tenantId, providerId),
      ),
      endpointToken: randomBytes(32).toString('base64url'),
      rateLimitPerSecond: 50,
      isDefault: true,
    },
  });
  const sender = await prisma.senderIdentity.create({
    data: {
      tenantId,
      providerConfigId: providerId,
      fromName: 'MCSupport',
      fromEmail: 'novedades@multicomputos.com',
      replyTo: 'soporte@multicomputos.com',
      isDefault: true,
    },
  });
  const [template, list] = await Promise.all([
    prisma.template.findFirst({ where: { tenantId, name: 'Actualización de producto' } }),
    prisma.contactList.findFirst({ where: { tenantId, name: 'Clientes activos' } }),
  ]);
  if (template && list) {
    await prisma.campaign.create({
      data: {
        tenantId,
        name: 'Lanzamiento MCSupport 3.2',
        templateId: template.id,
        senderIdentityId: sender.id,
        audience: { listIds: [list.id], segmentIds: [], excludeListIds: [] },
        createdById: adminId,
      },
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
    const deckId = await seedSampleDeck(prisma, mcsupport, admin.id);
    await seedDemoTemplates(prisma, mcsupport.id, admin.id, deckId);
    await seedDemoSending(prisma, mcsupport.id, admin.id);

    console.log(
      `Seed aplicado: administrador${passwordHash ? ' (contraseña inicial asignada)' : ''}, MCSupport con datos, plantillas, presentación, proveedor SMTP (Mailpit) y campaña de demostración, y MCLog vacío.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('El seed falló:', error);
  process.exit(1);
});
