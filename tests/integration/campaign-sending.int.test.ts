/**
 * Envío de campañas contra PostgreSQL y Redis reales:
 * - audiencia (listas, segmentos, exclusiones, supresiones, temas) sin duplicados;
 * - despacho idempotente y envío real por SMTP a Mailpit (localhost:1025);
 * - transiciones atómicas de entregas, estadísticas y aislamiento entre tenants;
 * - ritmo y cupos de envío en Redis y tokens de recuperación de contraseña de un solo uso.
 */
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DispatchCampaignUseCase,
  SendDeliveryUseCase,
} from '@/core/campaigns/use-cases/dispatch.use-cases';
import type { CampaignQueue } from '@/core/campaigns/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { EmailComposer } from '@/core/templates/email-composer';
import { HmacPublicAssetLinks } from '@/infrastructure/security/signed-asset-links';
import { HmacTrackingLinks } from '@/infrastructure/security/tracking-links';
import { RedisSendThrottle } from '@/infrastructure/security/send-throttle';
import { AesGcmSecretCipher } from '@/infrastructure/crypto/aes-gcm-secret-cipher';
import {
  CachingEmailProviderGateway,
  DefaultEmailProviderFactory,
} from '@/infrastructure/email-providers/provider-gateway';
import { SmtpEmailProvider } from '@/infrastructure/email-providers/smtp.provider';
import { SqlAudienceResolver } from '@/infrastructure/persistence/prisma/repositories/audience.sql-resolver';
import {
  PrismaContactFieldRepository,
  PrismaSegmentRepository,
} from '@/infrastructure/persistence/prisma/repositories/audience.prisma-repositories';
import { PrismaCampaignRepository } from '@/infrastructure/persistence/prisma/repositories/campaign.prisma-repository';
import { PrismaDeliveryRepository } from '@/infrastructure/persistence/prisma/repositories/delivery.prisma-repository';
import { PrismaDocumentRepository } from '@/infrastructure/persistence/prisma/repositories/document.prisma-repository';
import {
  PrismaPasswordResetTokenRepository,
  PrismaRecipientPreferencesRepository,
} from '@/infrastructure/persistence/prisma/repositories/engagement.prisma-repositories';
import {
  PrismaProviderConfigRepository,
  PrismaSenderRepository,
} from '@/infrastructure/persistence/prisma/repositories/provider.prisma-repositories';
import { PrismaTenantRepository } from '@/infrastructure/persistence/prisma/repositories/tenant.prisma-repository';
import { HtmlEmailCompiler } from '@/infrastructure/rendering/email-compiler';
import { TrackingEmailInstrumenter } from '@/infrastructure/rendering/email-instrumenter';
import { providerCredentialsAad } from '@/core/providers/use-cases/providers.use-cases';
import { createTestPrisma, createTestTenant } from './helpers';

const { prisma, clients } = createTestPrisma();
const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6390', {
  lazyConnect: true,
});
const MAILPIT_API = 'http://localhost:8025/api/v1';
const cipher = new AesGcmSecretCipher(new Map([['k1', Buffer.alloc(32, 7)]]), 'k1');
const campaigns = new PrismaCampaignRepository(prisma, clients);
const deliveries = new PrismaDeliveryRepository(prisma, clients);
const providers = new PrismaProviderConfigRepository(prisma, clients);
const senders = new PrismaSenderRepository(clients);
const tenants = new PrismaTenantRepository(prisma, clients);
const audience = new SqlAudienceResolver(
  prisma,
  new PrismaSegmentRepository(clients),
  new PrismaContactFieldRepository(clients),
);
const compiler = new HtmlEmailCompiler();

let tenant: TenantContext;
let other: TenantContext;
let listId: string;
let excludedListId: string;
let topicId: string;
let providerId: string;
let senderId: string;
const contacts: string[] = [];
const subjectTag = `int-${randomUUID().slice(0, 8)}`;

async function contact(
  email: string,
  extra: { status?: 'ACTIVE' | 'UNSUBSCRIBED'; country?: string } = {},
) {
  const row = await prisma.contact.create({
    data: {
      tenantId: tenant.tenantId,
      email,
      emailNormalized: email.toLowerCase(),
      firstName: email.split('@')[0] ?? null,
      status: extra.status ?? 'ACTIVE',
      attributes: extra.country ? { country: extra.country } : {},
    },
  });
  contacts.push(row.id);
  return row.id;
}

beforeAll(async () => {
  await redis.connect();
  tenant = await createTestTenant(prisma, 'send-a');
  other = await createTestTenant(prisma, 'send-b');
  await prisma.tenant.update({
    where: { id: tenant.tenantId },
    data: { postalAddress: 'Av. Lincoln 1007' },
  });
  listId = (
    await prisma.contactList.create({ data: { tenantId: tenant.tenantId, name: 'Clientes' } })
  ).id;
  excludedListId = (
    await prisma.contactList.create({ data: { tenantId: tenant.tenantId, name: 'Excluidos' } })
  ).id;
  topicId = (
    await prisma.topic.create({
      data: { tenantId: tenant.tenantId, key: 'news', name: { es: 'Novedades', en: 'News' } },
    })
  ).id;

  const inList = [
    await contact('ana@example.com'),
    await contact('luis@example.com'),
    await contact('baja@example.com', { status: 'UNSUBSCRIBED' }),
    await contact('suprimido@example.com'),
    await contact('excluido@example.com'),
    await contact('sintema@example.com'),
  ];
  await contact('segmento@example.com', { country: 'GT' });
  await prisma.listMembership.createMany({
    data: inList.map((contactId) => ({ tenantId: tenant.tenantId, listId, contactId })),
  });
  await prisma.listMembership.create({
    data: { tenantId: tenant.tenantId, listId: excludedListId, contactId: inList[4] ?? '' },
  });
  await prisma.suppression.create({
    data: {
      tenantId: tenant.tenantId,
      emailNormalized: 'suprimido@example.com',
      reason: 'HARD_BOUNCE',
      source: 'test',
    },
  });
  await prisma.contactTopicSubscription.create({
    data: { tenantId: tenant.tenantId, contactId: inList[5] ?? '', topicId, subscribed: false },
  });

  providerId = randomUUID();
  await prisma.emailProviderConfig.create({
    data: {
      id: providerId,
      tenantId: tenant.tenantId,
      name: 'Mailpit',
      kind: 'SMTP',
      settings: { host: 'localhost', port: 1025, security: 'none' },
      credentialsEnc: cipher.encrypt(
        JSON.stringify({ username: null, password: null }),
        providerCredentialsAad(tenant.tenantId, providerId),
      ),
      endpointToken: randomUUID().replaceAll('-', ''),
      rateLimitPerSecond: 50,
    },
  });
  senderId = (
    await prisma.senderIdentity.create({
      data: {
        tenantId: tenant.tenantId,
        providerConfigId: providerId,
        fromName: 'Pruebas',
        fromEmail: 'pruebas@multicomputos.com',
      },
    })
  ).id;
});

afterAll(async () => {
  await redis.quit();
  await prisma.$disconnect();
});

describe('SqlAudienceResolver', () => {
  it('combina listas y segmentos y excluye bajas, supresiones, listas excluidas y temas rechazados', async () => {
    await prisma.contactField.create({
      data: { tenantId: tenant.tenantId, key: 'country', label: 'País', type: 'STRING' },
    });
    const segment = await prisma.segment.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Guatemala',
        rules: {
          combinator: 'and',
          rules: [{ field: 'attr.country', operator: 'equals', value: 'GT' }],
        },
      },
    });
    const emails = async (topic: string | null) =>
      (
        await audience.page(
          tenant,
          { listIds: [listId], segmentIds: [segment.id], excludeListIds: [excludedListId] },
          topic,
          null,
          100,
        )
      )
        .map((row) => row.email)
        .sort();
    expect(await emails(null)).toEqual([
      'ana@example.com',
      'luis@example.com',
      'segmento@example.com',
      'sintema@example.com',
    ]);
    expect(await emails(topicId)).toEqual([
      'ana@example.com',
      'luis@example.com',
      'segmento@example.com',
    ]);
    expect(
      await audience.count(other, { listIds: [listId], segmentIds: [], excludeListIds: [] }, null),
    ).toBe(0);
  });
});

describe('despacho y envío real por SMTP (Mailpit)', () => {
  const queued: string[] = [];
  const queue: CampaignQueue = {
    enqueueDispatch: async () => {},
    enqueueSends: async (_context, ids) => void queued.push(...ids),
  };
  const links = new HmacTrackingLinks(
    'secreto-de-integracion-con-mas-de-32-caracteres',
    'https://app.test',
  );
  const composer = new EmailComposer({
    branding: tenants,
    fields: new PrismaContactFieldRepository(clients),
    documents: new PrismaDocumentRepository(clients),
    assets: new HmacPublicAssetLinks(
      'secreto-de-integracion-con-mas-de-32-caracteres',
      'https://app.test',
    ),
    compiler,
  });

  it('crea las entregas una sola vez aunque el despacho se repita y las envía con seguimiento', async () => {
    const campaign = await prisma.campaign.create({
      data: {
        tenantId: tenant.tenantId,
        name: 'Integración',
        status: 'SCHEDULED',
        version: 2,
        senderIdentityId: senderId,
        audience: { listIds: [listId], segmentIds: [], excludeListIds: [excludedListId] },
        body: {
          format: 'MARKDOWN',
          subject: `${subjectTag} Hola {{ contact.first_name }}`,
          preheader: 'Prueba',
          locale: 'es',
          content: { markdown: 'Visita [la web](https://multicomputos.com).' },
        },
        createdById: randomUUID(),
      },
    });
    const dispatch = new DispatchCampaignUseCase({
      campaigns,
      deliveries,
      audience,
      queue,
      senders,
      composer,
      instrumenter: new TrackingEmailInstrumenter(),
      clock: { now: () => new Date() },
    });
    await dispatch.execute(tenant, campaign.id, 2);
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'DISPATCHING' } });
    await dispatch.execute(tenant, campaign.id, 2);
    expect(await deliveries.count(tenant, campaign.id)).toBe(3);

    const send = new SendDeliveryUseCase({
      campaigns,
      deliveries,
      senders,
      providers,
      gateway: new CachingEmailProviderGateway(
        providers,
        cipher,
        new DefaultEmailProviderFactory({ allowPrivateHosts: true }),
      ),
      throttle: new RedisSendThrottle(redis),
      links,
      compiler,
      branding: tenants,
      preferences: new PrismaRecipientPreferencesRepository(clients),
      clock: { now: () => new Date() },
    });
    for (const id of new Set(queued)) {
      await send.execute(tenant, id, { finalAttempt: false });
      await send.execute(tenant, id, { finalAttempt: false });
    }
    const stats = await deliveries.stats(tenant, campaign.id);
    expect(stats.byStatus.SENT).toBe(3);

    const search = await fetch(
      `${MAILPIT_API}/search?query=${encodeURIComponent(`subject:"${subjectTag}"`)}`,
    );
    const found = (await search.json()) as {
      messages_count: number;
      messages: Array<{ ID: string }>;
    };
    expect(found.messages_count).toBe(3);
    const message = (await (
      await fetch(`${MAILPIT_API}/message/${found.messages[0]?.ID}`)
    ).json()) as { HTML: string };
    expect(message.HTML).toContain('https://app.test/trk/c/');
    expect(message.HTML).toContain('https://app.test/trk/o/');
    const headers = (await (
      await fetch(`${MAILPIT_API}/message/${found.messages[0]?.ID}/headers`)
    ).json()) as Record<string, string[]>;
    expect(headers['List-Unsubscribe-Post']).toEqual(['List-Unsubscribe=One-Click']);

    expect(await deliveries.count(other, campaign.id)).toBe(0);
    expect(await campaigns.findById(other, campaign.id)).toBeNull();
  });
});

describe('PrismaDeliveryRepository', () => {
  it('la reclamación es atómica y los eventos del proveedor no hacen retroceder el estado', async () => {
    const campaign = await prisma.campaign.create({
      data: { tenantId: tenant.tenantId, name: 'Atómica', createdById: randomUUID() },
    });
    await deliveries.createBatch(tenant, campaign.id, providerId, [
      { contactId: contacts[0] ?? '', email: 'ana@example.com', variant: null },
    ]);
    const [id] = await deliveries.queuedIds(tenant, campaign.id, null, 10);
    const claims = await Promise.all([
      deliveries.claim(tenant, id ?? '', new Date()),
      deliveries.claim(tenant, id ?? '', new Date()),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await deliveries.markSent(tenant, id ?? '', 'pm-1', new Date());
    expect(await deliveries.applyProviderStatus(tenant, id ?? '', 'BOUNCED', new Date())).toBe(
      true,
    );
    expect(await deliveries.applyProviderStatus(tenant, id ?? '', 'DELIVERED', new Date())).toBe(
      false,
    );
    await deliveries.recordOpen(tenant, id ?? '', new Date(), true);
    await deliveries.recordOpen(other, id ?? '', new Date(), false);
    const stats = await deliveries.stats(tenant, campaign.id);
    expect(stats).toMatchObject({ opened: 0, machineOpens: 1 });
    expect(stats.byStatus.BOUNCED).toBe(1);
  });
});

describe('límites de envío (Redis)', () => {
  const throttle = () => new RedisSendThrottle(redis);

  it('el ritmo por segundo espacia los envíos sin ráfagas en ninguna ventana deslizante', async () => {
    const scope = `provider:${randomUUID()}`;
    const limit = [{ mode: 'rate', points: 20, durationSeconds: 1 }] as const;
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => throttle().acquire(scope, limit)),
    );
    expect(concurrent.filter((result) => result.ok)).toHaveLength(1);
    const waits = concurrent.flatMap((result) => (result.ok ? [] : [result.retryAfterMs]));
    expect(Math.max(...waits)).toBeLessThanOrEqual(50);

    const granted: number[] = [];
    const deadline = Date.now() + 2_000;
    await Promise.all(
      Array.from({ length: 10 }, async () => {
        while (Date.now() < deadline) {
          const result = await throttle().acquire(scope, limit);
          if (result.ok) granted.push(Date.now());
          else await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs));
        }
      }),
    );
    const maxInAnySecond = Math.max(
      ...granted.map((start) => granted.filter((t) => t >= start && t < start + 1_000).length),
    );
    expect(maxInAnySecond).toBeLessThanOrEqual(21);
    expect(granted.length).toBeGreaterThanOrEqual(30);
  });

  it('un ritmo con decimales espacia los envíos (0,5/s = uno cada 2 s)', async () => {
    const scope = `provider:${randomUUID()}`;
    const limit = [{ mode: 'rate', points: 0.5, durationSeconds: 1 }] as const;
    expect(await throttle().acquire(scope, limit)).toEqual({ ok: true });
    const next = await throttle().acquire(scope, limit);
    expect(next.ok).toBe(false);
    if (!next.ok) {
      expect(next.retryAfterMs).toBeGreaterThan(1_900);
      expect(next.retryAfterMs).toBeLessThanOrEqual(2_000);
    }
  });

  it('el cupo por ventana fija concede exactamente los puntos configurados', async () => {
    const scope = `provider:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        throttle().acquire(scope, [{ mode: 'quota', points: 5, durationSeconds: 60 }]),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(5);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false });
  });
});

describe('SMTP y tokens de recuperación', () => {
  it('el adaptador SMTP verifica la conexión y envía a Mailpit', async () => {
    const provider = new SmtpEmailProvider(
      { host: 'localhost', port: 1025, security: 'none' },
      { username: null, password: null },
      true,
    );
    expect(await provider.verify()).toEqual({ ok: true });
    const result = await provider.send({
      from: { name: 'Pruebas', email: 'pruebas@multicomputos.com' },
      to: 'destino@example.com',
      replyTo: null,
      subject: `${subjectTag} directo`,
      html: '<p>Hola</p>',
      text: 'Hola',
      messageId: `<${randomUUID()}@multicomputos.com>`,
      headers: { 'X-MCSN-Test': 'true' },
      idempotencyKey: randomUUID(),
    });
    expect(result.ok).toBe(true);
    await provider.close();
  });

  it('el SMTP rechaza hosts privados si no se permiten (SSRF)', async () => {
    const provider = new SmtpEmailProvider(
      { host: '127.0.0.1', port: 1025, security: 'none' },
      { username: null, password: null },
      false,
    );
    expect(await provider.verify()).toMatchObject({ ok: false });
  });

  it('un token de recuperación solo se consume una vez y respeta la caducidad', async () => {
    const user = await prisma.user.create({ data: { email: `reset-${randomUUID()}@example.com` } });
    const repo = new PrismaPasswordResetTokenRepository(prisma);
    await repo.replace(user.id, 'hash-1', new Date(Date.now() + 60_000));
    await repo.replace(user.id, 'hash-2', new Date(Date.now() + 60_000));
    expect(await repo.consume('hash-1', new Date())).toBeNull();
    const [first, second] = await Promise.all([
      repo.consume('hash-2', new Date()),
      repo.consume('hash-2', new Date()),
    ]);
    expect([first, second].filter(Boolean)).toEqual([user.id]);
    await repo.replace(user.id, 'hash-3', new Date(Date.now() - 1000));
    expect(await repo.consume('hash-3', new Date())).toBeNull();
  });
});
