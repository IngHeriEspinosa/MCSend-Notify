/**
 * Repositorios de la Fase 4 contra PostgreSQL real: configuración y uso de IA, buzón de
 * novedades, automatizaciones, ejecuciones idempotentes, aprobaciones con decisión atómica y
 * aislamiento entre tenants.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  PrismaAiSettingsRepository,
  PrismaAiUsageRepository,
} from '@/infrastructure/persistence/prisma/repositories/ai.prisma-repositories';
import {
  PrismaApprovalRepository,
  PrismaAutomationRepository,
  PrismaAutomationRunRepository,
  PrismaMemberDirectory,
} from '@/infrastructure/persistence/prisma/repositories/automation.prisma-repositories';
import { PrismaChangelogRepository } from '@/infrastructure/persistence/prisma/repositories/changelog.prisma-repository';
import { automationDefinitionSchema } from '@/core/automations/automation';
import { createTestPrisma, createTestTenant } from './helpers';

const { prisma, clients } = createTestPrisma();
const settings = new PrismaAiSettingsRepository(clients);
const usage = new PrismaAiUsageRepository(clients);
const changelog = new PrismaChangelogRepository(clients);
const automations = new PrismaAutomationRepository(prisma, clients);
const runs = new PrismaAutomationRunRepository(clients);
const approvals = new PrismaApprovalRepository(prisma, clients);
const members = new PrismaMemberDirectory(clients);

let tenant: TenantContext;
let other: TenantContext;

const definition = () =>
  automationDefinitionSchema.parse({
    sources: [{ kind: 'changelog' }],
    locale: 'es',
    audience: { listIds: [randomUUID()] },
    topicId: null,
    senderIdentityId: randomUUID(),
    approverUserIds: [tenant.actor.type === 'user' ? tenant.actor.userId : randomUUID()],
  });

beforeAll(async () => {
  tenant = await createTestTenant(prisma, 'ai-a');
  other = await createTestTenant(prisma, 'ai-b');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('configuración y uso de IA', () => {
  it('guarda una configuración por tenant, incrementa la versión y la aísla', async () => {
    const write = {
      source: 'OWN' as const,
      kind: 'ANTHROPIC' as const,
      credentialsEnc: 'k1.iv.tag.ct',
      baseUrl: null,
      defaultModel: 'claude-opus-5-5',
      fastModel: null,
      monthlyBudgetUsd: 10,
      inputPricePerMTok: null,
      outputPricePerMTok: null,
    };
    const id = randomUUID();
    const first = await settings.save(tenant, id, write);
    const second = await settings.save(tenant, id, { ...write, monthlyBudgetUsd: 20 });
    expect(second).toMatchObject({
      id,
      configVersion: first.configVersion + 1,
      monthlyBudgetUsd: 20,
      hasApiKey: true,
    });
    await settings.setStatus(tenant, 'ERROR', 'invalid', null);
    expect((await settings.find(tenant))?.status).toBe('ERROR');
    expect(await settings.find(other)).toBeNull();
    expect(await settings.delete(other)).toBe(false);
  });

  it('acumula el coste del mes y resume por propósito', async () => {
    const since = new Date(Date.now() - 1000);
    const base = {
      userId: null,
      model: 'claude-opus-5-5',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 900,
    };
    await usage.record(tenant, {
      ...base,
      purpose: 'campaign_draft',
      costMicros: 1400,
      status: 'OK',
    });
    await usage.record(tenant, {
      ...base,
      purpose: 'campaign_draft',
      costMicros: 600,
      status: 'REFUSED',
    });
    await usage.record(tenant, { ...base, purpose: 'tone', costMicros: 100, status: 'OK' });
    await usage.record(other, { ...base, purpose: 'tone', costMicros: 99_999, status: 'OK' });
    expect(await usage.spentSince(tenant, since)).toBe(2100);
    const summary = await usage.summary(tenant, since);
    expect(summary).toMatchObject({ calls: 3, errors: 1, costMicros: 2100 });
    expect(summary.byPurpose[0]).toMatchObject({
      purpose: 'campaign_draft',
      calls: 2,
      costMicros: 2000,
    });
  });
});

describe('buzón de novedades', () => {
  it('publicar con el mismo externalId actualiza en lugar de duplicar, también en paralelo', async () => {
    const entry = {
      externalId: 'release-3.2.0',
      version: '3.2.0',
      title: 'Panel de SLA',
      bodyMd: '',
      category: 'FEATURE' as const,
      publishedAt: new Date(),
    };
    const results = await Promise.all([
      changelog.upsert(tenant, entry),
      changelog.upsert(tenant, { ...entry, title: 'Panel de SLA en tiempo real' }),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.entry.id)).size).toBe(1);
    expect(
      (await changelog.list(tenant, 10)).filter((item) => item.externalId === 'release-3.2.0'),
    ).toHaveLength(1);
    // Otro tenant puede usar el mismo externalId sin colisión.
    expect((await changelog.upsert(other, entry)).created).toBe(true);
  });

  it('las novedades enviadas no vuelven a usarse como fuente', async () => {
    const fresh = await changelog.upsert(tenant, {
      externalId: null,
      version: null,
      title: 'Exportar a Excel',
      bodyMd: 'Ver https://docs.example.com/excel',
      category: 'IMPROVEMENT',
      publishedAt: new Date(),
    });
    const since = new Date(Date.now() - 86_400_000);
    const before = await changelog.findForSources(tenant, since, true, 50);
    expect(before.map((item) => item.id)).toContain(fresh.entry.id);
    const runId = randomUUID();
    await changelog.markConsumed(tenant, [fresh.entry.id], runId, new Date());
    await changelog.markConsumed(tenant, [fresh.entry.id], randomUUID(), new Date());
    const after = await changelog.findForSources(tenant, since, true, 50);
    expect(after.map((item) => item.id)).not.toContain(fresh.entry.id);
    const all = await changelog.findForSources(tenant, since, false, 50);
    expect(all.find((item) => item.id === fresh.entry.id)?.consumedByRunId).toBe(runId);
  });
});

describe('automatizaciones, ejecuciones y aprobaciones', () => {
  it('ejecuciones idempotentes, transiciones atómicas y aprobaciones decididas una sola vez', async () => {
    const automation = await automations.create(tenant, {
      name: `Resumen ${randomUUID().slice(0, 6)}`,
      schedule: { frequency: 'weekly', weekday: 1, hour: 9, minute: 0 },
      timezone: 'America/Santo_Domingo',
      definition: definition(),
      createdById: tenant.actor.type === 'user' ? tenant.actor.userId : randomUUID(),
    });
    expect(automation.definition).toMatchObject({ requiresApproval: true, tone: 'professional' });
    await expect(
      automations.create(tenant, { ...automation, createdById: automation.createdById }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await automations.findById(other, automation.id)).toBeNull();

    await automations.setEnabled(tenant, automation.id, true);
    expect((await automations.listEnabled()).find((ref) => ref.id === automation.id)).toMatchObject(
      {
        tenantSlug: tenant.tenantSlug,
        timezone: 'America/Santo_Domingo',
      },
    );

    const key = `schedule-${randomUUID()}`;
    const started = await Promise.all(
      Array.from({ length: 3 }, () =>
        runs.start(tenant, {
          automationId: automation.id,
          idempotencyKey: key,
          trigger: 'schedule',
        }),
      ),
    );
    expect(started.filter((result) => result.created)).toHaveLength(1);
    const runId = started[0]?.run.id ?? '';
    expect(new Set(started.map((result) => result.run.id)).size).toBe(1);

    await runs.update(tenant, runId, {
      sources: [{ kind: 'changelog', title: 'Changelog', chars: 120 }],
    });
    expect(await runs.transition(tenant, runId, ['RUNNING'], { status: 'AWAITING_APPROVAL' })).toBe(
      true,
    );
    expect(await runs.transition(tenant, runId, ['RUNNING'], { status: 'FAILED' })).toBe(false);
    expect(
      (await automations.list(tenant)).find((item) => item.id === automation.id)?.lastRunStatus,
    ).toBe('AWAITING_APPROVAL');

    const approval = await approvals.create(tenant, {
      runId,
      campaignId: randomUUID(),
      approverUserIds: [randomUUID()],
      onTimeout: 'cancel',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(approval).toMatchObject({ automationName: automation.name, status: 'PENDING' });
    expect((await runs.findById(tenant, runId))?.approval).toMatchObject({ id: approval.id });
    expect((await approvals.findExpired(new Date(), 100)).map((item) => item.id)).toContain(
      approval.id,
    );
    expect(await approvals.countPending(tenant)).toBeGreaterThanOrEqual(1);

    const decisions = await Promise.all([
      approvals.decide(tenant, approval.id, {
        status: 'APPROVED',
        decidedById: null,
        comment: null,
        at: new Date(),
      }),
      approvals.decide(tenant, approval.id, {
        status: 'REJECTED',
        decidedById: null,
        comment: 'no',
        at: new Date(),
      }),
    ]);
    expect(decisions.filter(Boolean)).toHaveLength(1);
    expect(await approvals.findById(other, approval.id)).toBeNull();
  });

  it('el directorio de miembros solo devuelve miembros activos del tenant', async () => {
    const userId = tenant.actor.type === 'user' ? tenant.actor.userId : '';
    const otherUser = other.actor.type === 'user' ? other.actor.userId : '';
    const found = await members.findMembers(tenant, [userId, otherUser]);
    expect(found).toEqual([expect.objectContaining({ userId, role: 'OWNER', locale: 'es' })]);
  });
});
