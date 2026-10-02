import { beforeEach, describe, expect, it } from 'vitest';
import {
  fakeAssetLinks,
  InMemoryBrandingRepository,
  InMemoryDocumentRepository,
  InMemoryTemplateRepository,
} from '@tests/fakes/content.fakes';
import { FakeClock, RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import {
  campaignRecord,
  FakeAudience,
  FakeGateway,
  InMemoryCampaignRepository,
  InMemoryDeliveryRepository,
  InMemoryProviderRepository,
  InMemorySenderRepository,
  ownerContext,
  PROVIDER_ID,
  RecordingCampaignQueue,
  RecordingCompiler,
  sender,
  SENDER_ID,
} from '@tests/fakes/sending.fakes';
import type { ContactFieldRepository } from '@/core/contacts/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { EmailComposer } from '@/core/templates/email-composer';
import { ManageCampaignsUseCase, type CampaignUseCaseDeps } from './campaigns.use-cases';

const unused = async () => {
  throw new Error('no usado');
};
const fields: ContactFieldRepository = {
  list: async () => [],
  create: unused,
  delete: async () => false,
};
const countAll = {
  countExisting: async (_context: TenantContext, ids: readonly string[]) => ids.length,
};

let deps: CampaignUseCaseDeps & {
  campaigns: InMemoryCampaignRepository;
  deliveries: InMemoryDeliveryRepository;
  queue: RecordingCampaignQueue;
  providers: InMemoryProviderRepository;
  senders: InMemorySenderRepository;
  gateway: FakeGateway;
  audience: FakeAudience;
  compiler: RecordingCompiler;
  templates: InMemoryTemplateRepository;
};
let templateId: string;

function viewer(): TenantContext {
  return {
    ...ownerContext,
    actor: { type: 'user', userId: 'user-2', role: 'VIEWER', isPlatformAdmin: false },
  };
}

beforeEach(async () => {
  const compiler = new RecordingCompiler();
  const templates = new InMemoryTemplateRepository();
  const template = await templates.create(ownerContext, {
    name: 'Actualización',
    description: null,
    body: {
      format: 'MARKDOWN',
      subject: 'Hola {{ contact.first_name }}',
      preheader: 'p',
      locale: 'es',
      content: { markdown: 'x' },
    },
    note: null,
    userId: 'user-1',
  });
  templateId = template.id;
  deps = {
    campaigns: new InMemoryCampaignRepository(),
    deliveries: new InMemoryDeliveryRepository(),
    audience: new FakeAudience([{ contactId: 'c1', email: 'a@b.c' }]),
    queue: new RecordingCampaignQueue(),
    templates,
    senders: new InMemorySenderRepository(),
    providers: new InMemoryProviderRepository(),
    gateway: new FakeGateway(),
    composer: new EmailComposer({
      branding: new InMemoryBrandingRepository(),
      fields,
      documents: new InMemoryDocumentRepository(),
      assets: fakeAssetLinks,
      compiler,
    }),
    compiler,
    contacts: { findById: async () => null },
    lists: countAll,
    segments: { findById: async () => null },
    topics: countAll,
    audit: new RecordingAuditLogger(),
    clock: new FakeClock(),
  };
});

const manage = () => new ManageCampaignsUseCase(deps);

async function draft() {
  return manage().create(ownerContext, { name: 'Lanzamiento', templateId });
}

describe('ManageCampaignsUseCase', () => {
  it('crea el borrador con el remitente por defecto', async () => {
    const campaign = await draft();
    expect(campaign).toMatchObject({ status: 'DRAFT', senderIdentityId: SENDER_ID });
  });

  it('programar congela el contenido de la plantilla, sube la versión y encola el despacho con retraso', async () => {
    const campaign = await draft();
    const at = new Date(deps.clock.now().getTime() + 3_600_000);
    await manage().schedule(ownerContext, {
      campaignId: campaign.id,
      expectedVersion: campaign.version,
      scheduledAt: at,
      confirmRecipients: null,
    });
    const stored = deps.campaigns.campaigns.get(campaign.id);
    expect(stored).toMatchObject({
      status: 'SCHEDULED',
      templateVersion: 1,
      version: campaign.version + 1,
    });
    expect(stored?.body?.subject).toBe('Hola {{ contact.first_name }}');
    expect(deps.queue.dispatches).toEqual([
      { campaignId: campaign.id, version: campaign.version + 1, delayMs: 3_600_000 },
    ]);
  });

  it('bloquea el envío con errores (sin destinatarios, proveedor caído, sin remitente)', async () => {
    const campaign = await draft();
    deps.audience.recipients = [];
    const input = {
      campaignId: campaign.id,
      expectedVersion: campaign.version,
      scheduledAt: null,
      confirmRecipients: null,
    };
    await expect(manage().schedule(ownerContext, input)).rejects.toMatchObject({
      details: { reason: 'BLOCKING_ISSUES' },
    });
    const { issues } = await manage().checks(ownerContext, campaign.id);
    expect(issues.map((issue) => issue.code)).toContain('NO_RECIPIENTS');

    deps.audience.recipients = [{ contactId: 'c1', email: 'a@b.c' }];
    deps.providers.providers.set(PROVIDER_ID, {
      ...deps.providers.providers.get(PROVIDER_ID)!,
      status: 'ERROR',
    });
    expect((await manage().checks(ownerContext, campaign.id)).issues[0]).toMatchObject({
      code: 'PROVIDER_ERROR',
      severity: 'error',
    });
  });

  it('avisa (sin bloquear) si el dominio del remitente no tiene DNS correcto', async () => {
    deps.senders.senders.set(SENDER_ID, { ...sender, dnsCheck: null });
    const campaign = await draft();
    const { issues } = await manage().checks(ownerContext, campaign.id);
    expect(issues).toContainEqual({
      code: 'SENDER_DNS',
      severity: 'warning',
      detail: 'multicomputos.com',
    });
  });

  it('exige confirmar el número exacto de destinatarios en envíos grandes', async () => {
    deps.audience.recipients = Array.from({ length: 600 }, (_, index) => ({
      contactId: `c${index}`,
      email: `c${index}@x.y`,
    }));
    const campaign = await draft();
    const base = { campaignId: campaign.id, expectedVersion: campaign.version, scheduledAt: null };
    await expect(
      manage().schedule(ownerContext, { ...base, confirmRecipients: 599 }),
    ).rejects.toMatchObject({
      details: { reason: 'CONFIRMATION_REQUIRED', recipients: 600 },
    });
    await expect(
      manage().schedule(ownerContext, { ...base, confirmRecipients: 600 }),
    ).resolves.toMatchObject({ recipients: 600 });
  });

  it('rechaza fechas pasadas y versiones desactualizadas', async () => {
    const campaign = await draft();
    await expect(
      manage().schedule(ownerContext, {
        campaignId: campaign.id,
        expectedVersion: campaign.version,
        scheduledAt: new Date('2020-01-01'),
        confirmRecipients: null,
      }),
    ).rejects.toMatchObject({ details: { reason: 'SCHEDULE_IN_PAST' } });
    await expect(
      manage().schedule(ownerContext, {
        campaignId: campaign.id,
        expectedVersion: 99,
        scheduledAt: null,
        confirmRecipients: null,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('pausa, reanuda reencolando lo pendiente y cancela las entregas en cola', async () => {
    const campaign = deps.campaigns.add(
      campaignRecord({ status: 'SENDING', dispatchedAt: new Date() }),
    );
    await deps.deliveries.createBatch(ownerContext, campaign.id, PROVIDER_ID, [
      { contactId: 'c1', email: 'a@b.c', variant: null },
      { contactId: 'c2', email: 'd@e.f', variant: null },
    ]);
    await manage().pause(ownerContext, campaign.id);
    expect(deps.campaigns.campaigns.get(campaign.id)?.status).toBe('PAUSED');
    await manage().resume(ownerContext, campaign.id);
    expect(deps.campaigns.campaigns.get(campaign.id)?.status).toBe('SENDING');
    expect(deps.queue.sends).toHaveLength(2);
    await manage().cancel(ownerContext, campaign.id);
    expect(deps.campaigns.campaigns.get(campaign.id)?.status).toBe('CANCELLED');
    expect(
      [...deps.deliveries.deliveries.values()].every((item) => item.status === 'CANCELLED'),
    ).toBe(true);
  });

  it('no reanuda si el proveedor sigue con error', async () => {
    const campaign = deps.campaigns.add(campaignRecord({ status: 'PAUSED' }));
    deps.providers.providers.set(PROVIDER_ID, {
      ...deps.providers.providers.get(PROVIDER_ID)!,
      status: 'ERROR',
    });
    await expect(manage().resume(ownerContext, campaign.id)).rejects.toMatchObject({
      details: { reason: 'PROVIDER_ERROR' },
    });
  });

  it('el envío de prueba usa el prefijo [Prueba], sin seguimiento ni entregas', async () => {
    const campaign = await draft();
    const results = await manage().sendTest(ownerContext, {
      campaignId: campaign.id,
      emails: ['qa@multicomputos.com'],
    });
    expect(results).toEqual([{ email: 'qa@multicomputos.com', ok: true }]);
    expect(deps.gateway.provider.sent[0]?.subject).toBe('[Prueba] Hola Ana');
    expect(deps.compiler.variables[0]?.tracking).toBeUndefined();
    expect(deps.deliveries.deliveries.size).toBe(0);
  });

  it('un VIEWER consulta pero no edita ni envía', async () => {
    const campaign = await draft();
    await expect(manage().get(viewer(), campaign.id)).resolves.toMatchObject({ id: campaign.id });
    await expect(manage().create(viewer(), { name: 'X', templateId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(manage().pause(viewer(), campaign.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
