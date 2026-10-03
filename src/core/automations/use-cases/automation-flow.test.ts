/**
 * Flujo completo con dobles en memoria: ejecución de la automatización → aprobación → envío,
 * idempotencia, reanudación tras una caída, caducidad y concurrencia de decisiones.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FakeLanguageModelFactory,
  FakeMemberDirectory,
  FakeSourceFetcher,
  InMemoryAiSettingsRepository,
  InMemoryAiUsageRepository,
  InMemoryApprovalRepository,
  InMemoryAutomationRepository,
  InMemoryChangelogRepository,
  InMemoryRunRepository,
  RecordingAutomationScheduler,
  RecordingMailQueue,
  regexLinkFinder,
  reversibleCipher,
} from '@tests/fakes/ai.fakes';
import { campaignTestDeps, type CampaignTestDeps } from '@tests/fakes/campaign-deps';
import { InMemoryBrandingRepository, InMemoryDocumentRepository } from '@tests/fakes/content.fakes';
import { RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import { ownerContext, SENDER_ID, systemCtx, uuid } from '@tests/fakes/sending.fakes';
import { ContentCollector } from '@/core/ai/sources';
import { AiAssistUseCase } from '@/core/ai/use-cases/ai-assist.use-cases';
import { AiService } from '@/core/ai/use-cases/ai-service';
import { AiModelError } from '@/core/ai/ports';
import { ManageCampaignsUseCase } from '@/core/campaigns/use-cases/campaigns.use-cases';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { AutomationInput } from '../automation';
import { ApprovalsUseCase } from './approvals.use-cases';
import { ManageAutomationsUseCase } from './automations.use-cases';
import { RunAutomationUseCase } from './run-automation.use-case';

const AUTHOR = 'user-1';
const APPROVER = '77777777-7777-7777-8777-777777777777';
const LIST_ID = '55555555-5555-7555-8555-555555555555';

const DRAFT = {
  subject: 'Resumen semanal de MCSupport',
  preheader: 'Panel SLA y más',
  blocks: [
    { type: 'heading', text: 'Novedades de la semana', level: 1 },
    { type: 'text', markdown: 'Hola {{ contact.first_name }}, esto es lo nuevo.' },
  ],
};

let campaignDeps: CampaignTestDeps;
let factory: FakeLanguageModelFactory;
let changelog: InMemoryChangelogRepository;
let automations: InMemoryAutomationRepository;
let runs: InMemoryRunRepository;
let approvals: InMemoryApprovalRepository;
let scheduler: RecordingAutomationScheduler;
let mail: RecordingMailQueue;
let members: FakeMemberDirectory;

function campaigns() {
  return new ManageCampaignsUseCase(campaignDeps);
}

function runner() {
  const clock = campaignDeps.clock;
  const collector = new ContentCollector({
    fetcher: new FakeSourceFetcher(),
    documents: new InMemoryDocumentRepository(),
    changelog,
    clock,
  });
  const ai = new AiService({
    settings: new InMemoryAiSettingsRepository(),
    usage: new InMemoryAiUsageRepository(),
    factory,
    cipher: reversibleCipher,
    platform: { apiKey: null, maxMonthlyBudgetUsd: 50 },
    clock,
  });
  const assist = new AiAssistUseCase({
    ai,
    collector,
    clock,
    links: regexLinkFinder,
    branding: new InMemoryBrandingRepository(),
    fields: { list: async () => [] },
    lists: { list: async () => [] },
    tags: { list: async () => [] },
    segments: { previewCount: async () => 0 },
    campaigns: campaigns(),
  });
  return new RunAutomationUseCase({
    automations,
    runs,
    approvals,
    collector,
    assist,
    templates: campaignDeps.templates,
    campaignRepo: campaignDeps.campaigns,
    campaigns: campaigns(),
    changelog,
    members,
    mail,
    links: {
      approvalUrl: (context, id, locale) =>
        `https://app.test/${locale}/t/${context.tenantSlug}/approvals/${id}`,
    },
    branding: new InMemoryBrandingRepository(),
    audit: new RecordingAuditLogger(),
    clock,
  });
}

function approvalsUseCase() {
  return new ApprovalsUseCase({
    approvals,
    runs,
    campaigns: campaigns(),
    templates: campaignDeps.templates,
    audit: new RecordingAuditLogger(),
    clock: campaignDeps.clock,
  });
}

function manageAutomations() {
  return new ManageAutomationsUseCase({
    automations,
    runs,
    scheduler,
    members,
    senders: campaignDeps.senders,
    audit: new RecordingAuditLogger(),
    ids: { uuid },
  });
}

function input(overrides: Partial<AutomationInput['definition']> = {}): AutomationInput {
  return {
    name: 'Resumen semanal',
    schedule: { frequency: 'weekly', weekday: 1, hour: 9, minute: 0 },
    timezone: 'America/Santo_Domingo',
    definition: {
      sources: [{ kind: 'changelog', days: 7, onlyNew: true }],
      instructions: '',
      tone: 'professional',
      locale: 'es',
      audience: { listIds: [LIST_ID], segmentIds: [], excludeListIds: [] },
      topicId: null,
      senderIdentityId: SENDER_ID,
      requiresApproval: true,
      approverUserIds: [APPROVER],
      approvalTimeoutHours: 48,
      onTimeout: 'cancel',
      skipWhenNoNews: true,
      ...overrides,
    },
  };
}

function as(userId: string, role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER'): TenantContext {
  return { ...ownerContext, actor: { type: 'user', userId, role, isPlatformAdmin: false } };
}

async function automation(overrides: Partial<AutomationInput['definition']> = {}) {
  return manageAutomations().create(ownerContext, input(overrides));
}

const execute = (id: string, key = 'schedule-1', finalAttempt = true) =>
  runner().execute(systemCtx, id, key, { trigger: 'manual', finalAttempt });

beforeEach(() => {
  campaignDeps = campaignTestDeps();
  factory = new FakeLanguageModelFactory();
  changelog = new InMemoryChangelogRepository();
  automations = new InMemoryAutomationRepository();
  runs = new InMemoryRunRepository();
  approvals = new InMemoryApprovalRepository();
  scheduler = new RecordingAutomationScheduler();
  mail = new RecordingMailQueue();
  members = new FakeMemberDirectory([
    {
      userId: APPROVER,
      email: 'aprobador@multicomputos.com',
      name: 'Ana',
      locale: 'es',
      role: 'EDITOR',
    },
    {
      userId: 'viewer-1',
      email: 'lector@multicomputos.com',
      name: null,
      locale: 'en',
      role: 'VIEWER',
    },
  ]);
  changelog.add({ title: 'Panel de SLA', version: '3.2', publishedAt: campaignDeps.clock.now() });
});

describe('gestión de automatizaciones', () => {
  it('valida aprobadores con permiso de envío y programa la cola al activar', async () => {
    await expect(
      manageAutomations().create(ownerContext, input({ approverUserIds: ['viewer-1'] })),
    ).rejects.toMatchObject({ details: { reason: 'INVALID_APPROVER' } });
    await expect(manageAutomations().create(as('v', 'VIEWER'), input())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const created = await automation();
    expect(created).toMatchObject({ enabled: false, createdById: AUTHOR });
    await manageAutomations().setEnabled(ownerContext, created.id, true);
    expect(scheduler.upserts[0]).toMatchObject({
      id: created.id,
      timezone: 'America/Santo_Domingo',
      schedule: { frequency: 'weekly', weekday: 1 },
    });
    await manageAutomations().setEnabled(ownerContext, created.id, false);
    expect(scheduler.removed).toEqual([created.id]);
    const { idempotencyKey } = await manageAutomations().runNow(ownerContext, created.id);
    expect(scheduler.runs).toEqual([
      { automationId: created.id, key: idempotencyKey, trigger: 'manual' },
    ]);
  });
});

describe('ejecución con aprobación', () => {
  it('redacta, crea plantilla y campaña, marca las novedades y avisa a los aprobadores', async () => {
    const created = await automation();
    factory.respond(DRAFT);
    const run = await execute(created.id);

    expect(run).toMatchObject({ status: 'AWAITING_APPROVAL', error: null });
    const campaign = campaignDeps.campaigns.campaigns.get(run?.campaignId ?? '');
    expect(campaign).toMatchObject({
      status: 'PENDING_APPROVAL',
      createdById: AUTHOR,
      senderIdentityId: SENDER_ID,
      audience: { listIds: [LIST_ID] },
    });
    const template = campaignDeps.templates.templates.get(run?.templateId ?? '');
    expect(template?.body.subject).toBe('Resumen semanal de MCSupport');
    expect(changelog.entries[0]?.consumedByRunId).toBe(run?.id);

    const [approval] = [...approvals.approvals.values()];
    expect(approval).toMatchObject({ approverUserIds: [APPROVER], status: 'PENDING' });
    expect(approval?.expiresAt.getTime()).toBe(campaignDeps.clock.now().getTime() + 48 * 3_600_000);
    expect(mail.messages).toEqual([
      expect.objectContaining({
        kind: 'approval-request',
        to: 'aprobador@multicomputos.com',
        subject: 'Resumen semanal de MCSupport',
        recipients: 1,
        url: `https://app.test/es/t/mcsupport/approvals/${approval?.id}`,
      }),
    ]);
    // La campaña no sale sin aprobación.
    expect(campaignDeps.queue.dispatches).toEqual([]);
  });

  it('es idempotente: la misma clave no vuelve a redactar ni crea duplicados', async () => {
    const created = await automation();
    factory.respond(DRAFT);
    const first = await execute(created.id);
    const second = await execute(created.id);
    expect(second?.id).toBe(first?.id);
    expect(factory.requests).toHaveLength(1);
    expect(campaignDeps.templates.templates.size).toBe(1);
    expect(campaignDeps.campaigns.campaigns.size).toBe(1);
  });

  it('se reanuda tras una caída sin repetir la plantilla ya creada', async () => {
    const created = await automation();
    factory.respond(DRAFT);
    // Simula que el worker murió justo después de crear la plantilla.
    const { run } = await runs.start(systemCtx, {
      automationId: created.id,
      idempotencyKey: 'schedule-1',
      trigger: 'manual',
    });
    const template = await campaignDeps.templates.create(systemCtx, {
      name: 'Plantilla previa',
      description: null,
      body: {
        format: 'MARKDOWN',
        subject: 'Previa',
        preheader: null,
        locale: 'es',
        content: { markdown: 'x' },
      },
      note: null,
      userId: AUTHOR,
    });
    await runs.update(systemCtx, run.id, { templateId: template.id });

    const resumed = await execute(created.id);
    expect(resumed).toMatchObject({ status: 'AWAITING_APPROVAL', templateId: template.id });
    expect(factory.requests).toHaveLength(0);
    expect(campaignDeps.templates.templates.size).toBe(1);
  });

  it('sin novedades nuevas la ejecución se omite y no se envía nada', async () => {
    changelog.entries.splice(0);
    const created = await automation();
    const run = await execute(created.id);
    expect(run).toMatchObject({ status: 'SKIPPED' });
    expect(factory.requests).toHaveLength(0);
    expect(campaignDeps.campaigns.campaigns.size).toBe(0);
  });

  it('un error de IA definitivo deja la ejecución en FAILED; uno transitorio se reintenta', async () => {
    const created = await automation();
    factory.fail(new AiModelError('UNAVAILABLE', 'caído'));
    await expect(execute(created.id, 'k1', false)).rejects.toMatchObject({
      details: { reason: 'AI_UNAVAILABLE' },
    });
    expect([...runs.runs.values()][0]?.status).toBe('RUNNING');

    factory.fail(new AiModelError('INVALID_OUTPUT', 'json'));
    const failed = await execute(created.id, 'k1', false);
    expect(failed).toMatchObject({ status: 'FAILED', error: 'AI_INVALID_OUTPUT' });
  });

  it('sin aprobación configurada la campaña se programa sin confirmación tecleada', async () => {
    campaignDeps.audience.recipients = Array.from({ length: 600 }, (_, index) => ({
      contactId: `c${index}`,
      email: `c${index}@x.y`,
    }));
    const created = await automation({ requiresApproval: false, approverUserIds: [] });
    factory.respond(DRAFT);
    const run = await execute(created.id);
    expect(run).toMatchObject({ status: 'SCHEDULED' });
    expect(campaignDeps.campaigns.campaigns.get(run?.campaignId ?? '')?.status).toBe('SCHEDULED');
    expect(campaignDeps.queue.dispatches).toHaveLength(1);
    expect(mail.messages).toEqual([]);
  });
});

describe('aprobaciones', () => {
  async function pending() {
    const created = await automation();
    factory.respond(DRAFT);
    const run = await execute(created.id);
    const [approval] = [...approvals.approvals.values()];
    const campaign = campaignDeps.campaigns.campaigns.get(run?.campaignId ?? '');
    const template = campaignDeps.templates.templates.get(run?.templateId ?? '');
    if (!approval || !campaign || !template) throw new Error('flujo incompleto');
    return {
      approval,
      runId: run?.id ?? '',
      input: {
        approvalId: approval.id,
        campaignVersion: campaign.version,
        templateVersion: template.currentVersion,
        comment: '',
      },
    };
  }

  it('el aprobador aprueba: se congela la versión vista y se programa el envío', async () => {
    const { approval, input: decision, runId } = await pending();
    const detail = await approvalsUseCase().get(as(APPROVER, 'EDITOR'), approval.id);
    expect(detail).toMatchObject({ canDecide: true, recipients: 1, blocking: false });

    await approvalsUseCase().approve(as(APPROVER, 'EDITOR'), decision);
    expect(approvals.approvals.get(approval.id)).toMatchObject({
      status: 'APPROVED',
      decidedById: APPROVER,
    });
    expect(campaignDeps.campaigns.campaigns.get(approval.campaignId)?.status).toBe('SCHEDULED');
    expect(runs.runs.get(runId)?.status).toBe('SCHEDULED');
    expect(campaignDeps.queue.dispatches).toHaveLength(1);
  });

  it('la revisión muestra los enlaces que la IA propuso y se eliminaron', async () => {
    const created = await automation();
    factory.respond({
      ...DRAFT,
      blocks: [
        ...DRAFT.blocks,
        { type: 'button', label: 'Verificar', url: 'https://evil.example/login' },
      ],
    });
    await execute(created.id);
    const [approval] = [...approvals.approvals.values()];
    const detail = await approvalsUseCase().get(as(APPROVER, 'EDITOR'), approval?.id ?? '');
    expect(detail.removedLinks).toEqual(['https://evil.example/login']);
  });

  it('solo deciden los aprobadores designados, propietarios o administradores', async () => {
    const { input: decision } = await pending();
    await expect(
      approvalsUseCase().approve(as('otro-editor', 'EDITOR'), decision),
    ).rejects.toMatchObject({ details: { reason: 'NOT_APPROVER' } });
    await expect(
      approvalsUseCase().approve(as('admin', 'ADMIN'), decision),
    ).resolves.toBeUndefined();
  });

  it('si la plantilla cambió después de revisarla, la aprobación falla', async () => {
    const { input: decision, approval } = await pending();
    const campaign = campaignDeps.campaigns.campaigns.get(approval.campaignId);
    const template = campaignDeps.templates.templates.get(campaign?.templateId ?? '');
    if (!template) throw new Error('sin plantilla');
    await campaignDeps.templates.saveVersion(systemCtx, template.id, template.currentVersion, {
      name: template.name,
      description: null,
      body: { ...template.body, subject: 'Cambiado' },
      note: null,
      userId: AUTHOR,
    });
    await expect(
      approvalsUseCase().approve(as(APPROVER, 'EDITOR'), decision),
    ).rejects.toMatchObject({
      details: { reason: 'TEMPLATE_CHANGED' },
    });
    expect(approvals.approvals.get(approval.id)?.status).toBe('PENDING');
  });

  it('rechazar devuelve la campaña a borrador; una decisión posterior ya no es posible', async () => {
    const { approval, input: decision, runId } = await pending();
    await approvalsUseCase().reject(as(APPROVER, 'EDITOR'), {
      approvalId: approval.id,
      comment: 'Revisar',
    });
    expect(campaignDeps.campaigns.campaigns.get(approval.campaignId)?.status).toBe('DRAFT');
    expect(approvals.approvals.get(approval.id)).toMatchObject({
      status: 'REJECTED',
      comment: 'Revisar',
    });
    expect(runs.runs.get(runId)?.status).toBe('REJECTED');
    await expect(
      approvalsUseCase().approve(as(APPROVER, 'EDITOR'), decision),
    ).rejects.toMatchObject({
      details: { reason: 'APPROVAL_DECIDED' },
    });
  });

  it('carrera: si otra persona ya aprobó, el rechazo falla sin cambiar la decisión', async () => {
    const { approval, input: decision } = await pending();
    // Ambas personas cargaron la aprobación pendiente; la primera aprueba.
    const stale = { ...approval };
    await approvalsUseCase().approve(as(APPROVER, 'EDITOR'), decision);
    approvals.approvals.set(approval.id, { ...stale }); // la segunda aún la ve PENDING
    await expect(
      approvalsUseCase().reject(as('admin', 'ADMIN'), { approvalId: approval.id, comment: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(campaignDeps.campaigns.campaigns.get(approval.campaignId)?.status).toBe('SCHEDULED');
  });

  it('al caducar se cancela por defecto, o se envía si así se configuró', async () => {
    const { approval, runId } = await pending();
    campaignDeps.clock.advance(49 * 3_600_000);
    await expect(
      approvalsUseCase().approve(as(APPROVER, 'EDITOR'), {
        approvalId: approval.id,
        campaignVersion: 1,
        templateVersion: 1,
        comment: '',
      }),
    ).rejects.toMatchObject({ code: 'EXPIRED' });
    expect(await approvalsUseCase().expireDue()).toBe(1);
    expect(campaignDeps.campaigns.campaigns.get(approval.campaignId)?.status).toBe('CANCELLED');
    expect(approvals.approvals.get(approval.id)?.status).toBe('EXPIRED');
    expect(runs.runs.get(runId)?.status).toBe('EXPIRED');

    const sendOnTimeout = await automation({ onTimeout: 'send' });
    changelog.add({ title: 'Exportar a Excel', publishedAt: campaignDeps.clock.now() });
    factory.respond(DRAFT);
    const run = await execute(sendOnTimeout.id, 'k2');
    campaignDeps.clock.advance(49 * 3_600_000);
    await approvalsUseCase().expireDue();
    expect(campaignDeps.campaigns.campaigns.get(run?.campaignId ?? '')?.status).toBe('SCHEDULED');
    expect(runs.runs.get(run?.id ?? '')?.status).toBe('SCHEDULED');
  });

  it('la caducidad nunca cancela una campaña ya programada', async () => {
    const { approval } = await pending();
    await campaigns().approve(systemCtx, approval.campaignId, {
      campaignVersion: campaignDeps.campaigns.campaigns.get(approval.campaignId)?.version ?? 0,
      templateVersion: 1,
    });
    campaignDeps.clock.advance(49 * 3_600_000);
    await approvalsUseCase().expireDue();
    expect(campaignDeps.campaigns.campaigns.get(approval.campaignId)?.status).toBe('SCHEDULED');
    await expect(
      campaigns().expirePendingApproval(ownerContext, approval.campaignId),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
