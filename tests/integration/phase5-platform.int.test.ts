/**
 * Repositorios de la Fase 5 contra PostgreSQL real: webhooks salientes (suscripción por evento,
 * desactivación automática, aislamiento), automatizaciones por evento, retención por lotes,
 * supresión RGPD de un contacto, rotación de claves y uso de IA por tenant.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { automationDefinitionSchema } from '@/core/automations/automation';
import { providerCredentialsAad } from '@/core/providers/use-cases/providers.use-cases';
import type { TenantContext } from '@/core/shared/tenant-context';
import { webhookSecretAad } from '@/core/webhooks/webhook';
import { AesGcmSecretCipher } from '@/infrastructure/crypto/aes-gcm-secret-cipher';
import { rotateSecrets } from '@/infrastructure/crypto/secret-rotation';
import { PrismaPlatformAiUsageRepository } from '@/infrastructure/persistence/prisma/repositories/ai.prisma-repositories';
import { PrismaAutomationRepository } from '@/infrastructure/persistence/prisma/repositories/automation.prisma-repositories';
import {
  PrismaPersonalDataEraser,
  PrismaRetentionRepository,
} from '@/infrastructure/persistence/prisma/repositories/privacy.prisma-repositories';
import {
  PrismaWebhookDeliveryRepository,
  PrismaWebhookEndpointRepository,
} from '@/infrastructure/persistence/prisma/repositories/webhook.prisma-repositories';
import { createTestPrisma, createTestTenant } from './helpers';

const { prisma, clients } = createTestPrisma();
const endpoints = new PrismaWebhookEndpointRepository(clients);
const webhookDeliveries = new PrismaWebhookDeliveryRepository(clients);
const automations = new PrismaAutomationRepository(prisma, clients);
const retention = new PrismaRetentionRepository(prisma);
const eraser = new PrismaPersonalDataEraser(prisma);
const platformUsage = new PrismaPlatformAiUsageRepository(prisma);

let tenant: TenantContext;
let other: TenantContext;

const userId = (context: TenantContext) =>
  context.actor.type === 'user' ? context.actor.userId : randomUUID();

async function webhookEndpoint(context: TenantContext, events: string[], secretEnc = 'k1.a.b.c') {
  return endpoints.create(context, {
    id: randomUUID(),
    url: 'https://hooks.example.com/mcsn',
    description: null,
    events: events.filter(
      (event): event is 'campaign.sent' | 'delivery.bounced' =>
        event === 'campaign.sent' || event === 'delivery.bounced',
    ),
    enabled: true,
    secretEnc,
    createdById: userId(context),
  });
}

beforeAll(async () => {
  tenant = await createTestTenant(prisma, 'p5-a');
  other = await createTestTenant(prisma, 'p5-b');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('webhooks salientes', () => {
  it('filtra por evento y estado, oculta el secreto y aísla entre tenants', async () => {
    const sent = await webhookEndpoint(tenant, ['campaign.sent']);
    const both = await webhookEndpoint(tenant, ['campaign.sent', 'delivery.bounced']);
    await webhookEndpoint(other, ['campaign.sent']);
    expect(sent).not.toHaveProperty('secretEnc');

    const subscribed = await endpoints.findSubscribed(tenant, 'delivery.bounced');
    expect(subscribed.map((endpoint) => endpoint.id)).toEqual([both.id]);
    expect((await endpoints.findSubscribed(tenant, 'campaign.sent')).length).toBe(2);
    expect(await endpoints.findById(other, sent.id)).toBeNull();
    expect(await endpoints.delete(other, sent.id)).toBe(false);
    expect((await endpoints.findById(tenant, sent.id))?.secretEnc).toBe('k1.a.b.c');
  });

  it('cuenta fallos definitivos, se desactiva al umbral y reactivar reinicia el contador', async () => {
    const endpoint = await webhookEndpoint(tenant, ['campaign.sent']);
    const failure = { ok: false, status: 500, error: 'HTTP 500', at: new Date(), disableAfter: 3 };
    await endpoints.recordResult(tenant, endpoint.id, failure);
    await endpoints.recordResult(tenant, endpoint.id, {
      ...failure,
      ok: true,
      status: 200,
      error: null,
    });
    expect((await endpoints.findById(tenant, endpoint.id))?.failureCount).toBe(0);

    for (let index = 0; index < 3; index += 1) {
      await endpoints.recordResult(tenant, endpoint.id, failure);
    }
    const disabled = await endpoints.findById(tenant, endpoint.id);
    expect(disabled).toMatchObject({ enabled: false, failureCount: 3, lastStatus: 500 });
    expect(await endpoints.findSubscribed(tenant, 'campaign.sent')).not.toContainEqual(
      expect.objectContaining({ id: endpoint.id }),
    );

    await endpoints.update(tenant, endpoint.id, { enabled: true });
    expect(await endpoints.findById(tenant, endpoint.id)).toMatchObject({
      enabled: true,
      failureCount: 0,
    });
  });

  it('registra entregas con su carga y las lista por destino', async () => {
    const endpoint = await webhookEndpoint(tenant, ['campaign.sent']);
    const eventId = randomUUID();
    const id = randomUUID();
    await webhookDeliveries.createMany(tenant, [
      { id, endpointId: endpoint.id, eventId, eventType: 'campaign.sent', payload: { n: 1 } },
    ]);
    await webhookDeliveries.update(tenant, id, {
      status: 'SUCCEEDED',
      attempts: 2,
      responseStatus: 204,
      error: null,
      deliveredAt: new Date(),
    });
    expect(await webhookDeliveries.findById(tenant, id)).toMatchObject({
      eventId,
      payload: { n: 1 },
      status: 'SUCCEEDED',
      attempts: 2,
    });
    expect(await webhookDeliveries.findById(other, id)).toBeNull();
    expect(await webhookDeliveries.listByEndpoint(tenant, endpoint.id, 10)).toHaveLength(1);
  });
});

describe('automatizaciones por evento', () => {
  it('encuentra solo las activas del tenant que escuchan el evento', async () => {
    const definition = automationDefinitionSchema.parse({
      sources: [{ kind: 'changelog' }],
      locale: 'es',
      audience: { listIds: [randomUUID()] },
      topicId: null,
      senderIdentityId: randomUUID(),
      approverUserIds: [userId(tenant)],
    });
    const base = {
      schedule: { frequency: 'weekly' as const, weekday: 1, hour: 9, minute: 0 },
      timezone: 'UTC',
      definition,
      createdById: userId(tenant),
    };
    const active = await automations.create(tenant, {
      ...base,
      name: `Evento ${randomUUID().slice(0, 6)}`,
      eventKey: 'release.published',
    });
    await automations.setEnabled(tenant, active.id, true);
    await automations.create(tenant, {
      ...base,
      name: `Inactiva ${randomUUID().slice(0, 6)}`,
      eventKey: 'release.published',
    });
    expect(active.eventKey).toBe('release.published');
    expect(
      (await automations.findByEventKey(tenant, 'release.published')).map((item) => item.id),
    ).toEqual([active.id]);
    expect(await automations.findByEventKey(other, 'release.published')).toEqual([]);
  });
});

describe('privacidad', () => {
  async function campaignWithDelivery(context: TenantContext, email: string) {
    const contact = await prisma.contact.create({
      data: { tenantId: context.tenantId, email, emailNormalized: email },
    });
    const provider = await prisma.emailProviderConfig.create({
      data: {
        tenantId: context.tenantId,
        name: `Mailpit ${randomUUID().slice(0, 6)}`,
        kind: 'SMTP',
        endpointToken: randomUUID().replaceAll('-', ''),
      },
    });
    const campaign = await prisma.campaign.create({
      data: { tenantId: context.tenantId, name: 'Campaña', createdById: userId(context) },
    });
    const delivery = await prisma.delivery.create({
      data: {
        tenantId: context.tenantId,
        campaignId: campaign.id,
        contactId: contact.id,
        email,
        providerConfigId: provider.id,
      },
    });
    await prisma.deliveryEvent.create({
      data: {
        tenantId: context.tenantId,
        deliveryId: delivery.id,
        campaignId: campaign.id,
        type: 'OPENED',
        source: 'tracking',
        userAgent: 'Mozilla/5.0',
      },
    });
    return { contact, campaign, delivery };
  }

  it('suprime el contacto y anonimiza solo sus entregas, sin tocar otros tenants', async () => {
    const mine = await campaignWithDelivery(tenant, `borrar-${randomUUID()}@example.com`);
    const foreign = await campaignWithDelivery(other, `ajeno-${randomUUID()}@example.com`);

    expect(await eraser.eraseContact(other, mine.contact.id)).toBeNull();
    expect(await eraser.eraseContact(tenant, mine.contact.id)).toEqual({ deliveries: 1 });

    expect(await prisma.contact.findUnique({ where: { id: mine.contact.id } })).toBeNull();
    const delivery = await prisma.delivery.findUnique({ where: { id: mine.delivery.id } });
    expect(delivery?.email).toBe(`erased-${mine.delivery.id}@erased.invalid`);
    const [event] = await prisma.deliveryEvent.findMany({
      where: { deliveryId: mine.delivery.id },
    });
    expect(event).toMatchObject({ type: 'OPENED', userAgent: null });
    expect((await prisma.delivery.findUnique({ where: { id: foreign.delivery.id } }))?.email).toBe(
      foreign.delivery.email,
    );
  });

  it('la retención borra solo las filas anteriores al corte', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const base = {
      tenantId: tenant.tenantId,
      purpose: 'draft',
      model: 'claude-opus-5-5',
      status: 'OK' as const,
    };
    const [stale, fresh] = await Promise.all([
      prisma.aiUsage.create({ data: { ...base, createdAt: old } }),
      prisma.aiUsage.create({ data: base }),
    ]);
    const purged = await retention.purge('ai_usage', new Date('2021-01-01T00:00:00Z'));
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await prisma.aiUsage.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await prisma.aiUsage.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });

  it('recifra con la clave activa, conserva el valor y deja intactas las ilegibles', async () => {
    const k1 = Buffer.alloc(32, 1);
    const k2 = Buffer.alloc(32, 2);
    const old = new AesGcmSecretCipher(new Map([['k1', k1]]), 'k1');
    const current = new AesGcmSecretCipher(
      new Map([
        ['k1', k1],
        ['k2', k2],
      ]),
      'k2',
    );
    const providerId = randomUUID();
    await prisma.emailProviderConfig.create({
      data: {
        id: providerId,
        tenantId: tenant.tenantId,
        name: `Rotación ${randomUUID().slice(0, 6)}`,
        kind: 'SMTP',
        endpointToken: randomUUID().replaceAll('-', ''),
        credentialsEnc: old.encrypt(
          '{"password":"s3cr3t"}',
          providerCredentialsAad(tenant.tenantId, providerId),
        ),
      },
    });
    const endpointId = randomUUID();
    await endpoints.create(tenant, {
      id: endpointId,
      url: 'https://hooks.example.com',
      description: null,
      events: ['campaign.sent'],
      enabled: true,
      secretEnc: old.encrypt('whsec_x', webhookSecretAad(tenant.tenantId, endpointId)),
      createdById: userId(tenant),
    });
    // Ilegible: cifrada con el AAD de otra fila.
    const brokenId = randomUUID();
    await endpoints.create(tenant, {
      id: brokenId,
      url: 'https://hooks.example.com',
      description: null,
      events: ['campaign.sent'],
      enabled: true,
      secretEnc: old.encrypt('whsec_y', webhookSecretAad(tenant.tenantId, endpointId)),
      createdById: userId(tenant),
    });

    const dryRun = await rotateSecrets(prisma, current, { dryRun: true });
    const providerReport = dryRun.find((report) => report.table.startsWith('email_provider'));
    expect(providerReport?.rotated).toBeGreaterThanOrEqual(1);
    const unchanged = await prisma.emailProviderConfig.findUnique({ where: { id: providerId } });
    expect(unchanged?.credentialsEnc?.startsWith('k1.')).toBe(true);

    const applied = await rotateSecrets(prisma, current, { dryRun: false });
    const provider = await prisma.emailProviderConfig.findUnique({ where: { id: providerId } });
    expect(provider?.credentialsEnc?.startsWith('k2.')).toBe(true);
    expect(
      current.decrypt(
        provider?.credentialsEnc ?? '',
        providerCredentialsAad(tenant.tenantId, providerId),
      ),
    ).toBe('{"password":"s3cr3t"}');
    const endpoint = await endpoints.findById(tenant, endpointId);
    expect(
      current.decrypt(endpoint?.secretEnc ?? '', webhookSecretAad(tenant.tenantId, endpointId)),
    ).toBe('whsec_x');
    const webhookReport = applied.find((report) => report.table.startsWith('webhook'));
    expect(webhookReport?.failed).toContain(brokenId);
    expect((await endpoints.findById(tenant, brokenId))?.secretEnc.startsWith('k1.')).toBe(true);
  });
});

describe('uso de IA de la plataforma', () => {
  it('agrega por tenant en el rango e incluye tenants sin uso', async () => {
    const empty = await createTestTenant(prisma, 'p5-empty');
    await prisma.aiSettings.create({
      data: {
        tenantId: tenant.tenantId,
        source: 'PLATFORM',
        kind: 'ANTHROPIC',
        defaultModel: 'claude-opus-5-5',
        monthlyBudgetUsd: 25,
      },
    });
    const at = new Date('2026-08-15T12:00:00Z');
    const base = {
      tenantId: tenant.tenantId,
      purpose: 'draft',
      model: 'claude-opus-5-5',
      createdAt: at,
    };
    await prisma.aiUsage.createMany({
      data: [
        { ...base, status: 'OK', costMicros: 1_500_000, inputTokens: 1000, outputTokens: 200 },
        { ...base, status: 'ERROR', costMicros: 0 },
        {
          ...base,
          status: 'OK',
          costMicros: 9_000_000,
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      ],
    });

    const rows = await platformUsage.byTenant(
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(rows.find((row) => row.tenantId === tenant.tenantId)).toMatchObject({
      source: 'PLATFORM',
      monthlyBudgetUsd: 25,
      calls: 2,
      errors: 1,
      inputTokens: 1000,
      outputTokens: 200,
      costMicros: 1_500_000,
    });
    expect(rows.find((row) => row.tenantId === empty.tenantId)).toMatchObject({
      source: null,
      calls: 0,
      costMicros: 0,
    });
  });
});
