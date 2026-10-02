import { beforeEach, describe, expect, it } from 'vitest';
import {
  fakeAssetLinks,
  InMemoryBrandingRepository,
  InMemoryDocumentRepository,
} from '@tests/fakes/content.fakes';
import { FakeClock } from '@tests/fakes/identity.fakes';
import {
  campaignRecord,
  FakeAudience,
  FakeGateway,
  FakePreferences,
  FakeThrottle,
  fakeInstrumenter,
  fakeTrackingLinks,
  InMemoryCampaignRepository,
  InMemoryDeliveryRepository,
  InMemoryProviderRepository,
  InMemorySenderRepository,
  PROVIDER_ID,
  RecordingCampaignQueue,
  RecordingCompiler,
  systemCtx,
} from '@tests/fakes/sending.fakes';
import type { ContactFieldRepository } from '@/core/contacts/ports';
import { EmailComposer } from '@/core/templates/email-composer';
import {
  CampaignMaintenanceUseCase,
  DispatchCampaignUseCase,
  SendDeliveryUseCase,
  TransientSendError,
} from './dispatch.use-cases';

const fields: ContactFieldRepository = {
  list: async () => [],
  create: async () => {
    throw new Error('no usado');
  },
  delete: async () => false,
};

let campaigns: InMemoryCampaignRepository;
let deliveries: InMemoryDeliveryRepository;
let queue: RecordingCampaignQueue;
let gateway: FakeGateway;
let throttle: FakeThrottle;
let providers: InMemoryProviderRepository;
let preferences: FakePreferences;
let compiler: RecordingCompiler;
let clock: FakeClock;

function recipients(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    contactId: `aaaaaaaa-0000-7000-8000-${String(index).padStart(12, '0')}`,
    email: `cliente${index}@example.com`,
  }));
}

function dispatcher(audience = new FakeAudience(recipients(5))) {
  return new DispatchCampaignUseCase({
    campaigns,
    deliveries,
    audience,
    queue,
    senders: new InMemorySenderRepository(),
    composer: new EmailComposer({
      branding: new InMemoryBrandingRepository(),
      fields,
      documents: new InMemoryDocumentRepository(),
      assets: fakeAssetLinks,
      compiler,
    }),
    instrumenter: fakeInstrumenter,
    clock,
  });
}

function sender() {
  return new SendDeliveryUseCase({
    campaigns,
    deliveries,
    senders: new InMemorySenderRepository(),
    providers,
    gateway,
    throttle,
    links: fakeTrackingLinks,
    compiler,
    branding: new InMemoryBrandingRepository(),
    preferences,
    clock,
  });
}

beforeEach(() => {
  campaigns = new InMemoryCampaignRepository();
  deliveries = new InMemoryDeliveryRepository();
  queue = new RecordingCampaignQueue();
  gateway = new FakeGateway();
  throttle = new FakeThrottle();
  providers = new InMemoryProviderRepository();
  preferences = new FakePreferences();
  compiler = new RecordingCompiler();
  clock = new FakeClock();
});

async function dispatched(count = 5) {
  const campaign = campaigns.add(campaignRecord({ status: 'SCHEDULED', version: 2 }));
  await dispatcher(new FakeAudience(recipients(count))).execute(systemCtx, campaign.id, 2);
  return campaign;
}

describe('DispatchCampaignUseCase', () => {
  it('compila una vez, crea una entrega por destinatario y las encola', async () => {
    const campaign = await dispatched(5);
    const record = campaigns.campaigns.get(campaign.id);
    expect(record).toMatchObject({ status: 'SENDING', recipientCount: 5 });
    expect(campaigns.compiled.get(campaign.id)?.html).toContain('tracking.links.l0');
    expect(campaigns.links.get(campaign.id)).toEqual([
      { id: 'link-0', position: 0, url: 'https://multicomputos.com/novedades' },
    ]);
    expect(deliveries.deliveries.size).toBe(5);
    expect(queue.sends).toHaveLength(5);
  });

  it('es idempotente: un reintento del job no duplica entregas', async () => {
    const campaign = campaigns.add(campaignRecord({ status: 'SCHEDULED', version: 1 }));
    const audience = new FakeAudience(recipients(3));
    await dispatcher(audience).execute(systemCtx, campaign.id, 1);
    campaigns.campaigns.set(campaign.id, {
      ...campaigns.campaigns.get(campaign.id)!,
      status: 'DISPATCHING',
      dispatchCursor: null,
    });
    await dispatcher(audience).execute(systemCtx, campaign.id, 1);
    expect(deliveries.deliveries.size).toBe(3);
  });

  it('ignora jobs obsoletos (versión distinta tras reprogramar)', async () => {
    const campaign = campaigns.add(campaignRecord({ status: 'SCHEDULED', version: 3 }));
    await dispatcher().execute(systemCtx, campaign.id, 2);
    expect(campaigns.campaigns.get(campaign.id)?.status).toBe('SCHEDULED');
    expect(deliveries.deliveries.size).toBe(0);
  });

  it('se detiene si la campaña se pausa durante el despacho y guarda el cursor', async () => {
    const campaign = campaigns.add(campaignRecord({ status: 'SCHEDULED', version: 1 }));
    campaigns.pauseAfterReads = 1;
    await dispatcher(new FakeAudience(recipients(2500))).execute(systemCtx, campaign.id, 1);
    const record = campaigns.campaigns.get(campaign.id);
    expect(record?.status).toBe('PAUSED');
    expect(record?.dispatchCursor).not.toBeNull();
    expect(deliveries.deliveries.size).toBe(1000);
  });

  it('una audiencia vacía termina como enviada sin entregas', async () => {
    const campaign = await dispatched(0);
    expect(campaigns.campaigns.get(campaign.id)).toMatchObject({
      status: 'SENT',
      recipientCount: 0,
    });
  });

  it('falla si el contenido tiene errores bloqueantes al despachar', async () => {
    compiler.issues = [{ code: 'DOCUMENT_UNAVAILABLE', severity: 'error', detail: 'x' }];
    const campaign = await dispatched(2);
    expect(campaigns.campaigns.get(campaign.id)).toMatchObject({
      status: 'FAILED',
      error: 'BLOCKING_ISSUES',
    });
  });
});

describe('SendDeliveryUseCase', () => {
  async function oneQueued(overrides: Parameters<typeof campaignRecord>[0] = {}) {
    const campaign = await dispatched(1);
    if (Object.keys(overrides).length > 0) {
      campaigns.campaigns.set(campaign.id, {
        ...campaigns.campaigns.get(campaign.id)!,
        ...overrides,
      });
    }
    const delivery = [...deliveries.deliveries.values()][0]!;
    return { campaign, delivery };
  }

  it('envía con cabeceras de baja, Message-ID determinista y variables de seguimiento', async () => {
    const { delivery } = await oneQueued();
    const outcome = await sender().execute(systemCtx, delivery.id, { finalAttempt: false });
    expect(outcome).toEqual({ type: 'done' });
    const email = gateway.provider.sent[0]!;
    expect(email.messageId).toBe(`<${delivery.id}@multicomputos.com>`);
    expect(email.headers['List-Unsubscribe']).toBe(`<https://app.test/trk/u/${delivery.id}>`);
    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(email.subject).toBe('Hola Ana');
    expect(compiler.variables[0]?.tracking?.links.l0).toBe(
      `https://app.test/trk/c/${delivery.id}/link-0`,
    );
    expect(deliveries.deliveries.get(delivery.id)).toMatchObject({
      status: 'SENT',
      providerMessageId: 'msg-1',
      attempts: 1,
    });
    expect(deliveries.events.map((event) => event.type)).toEqual(['SENT']);
  });

  it('no envía dos veces la misma entrega (un segundo job no la reclama)', async () => {
    const { delivery } = await oneQueued();
    await sender().execute(systemCtx, delivery.id, { finalAttempt: false });
    await sender().execute(systemCtx, delivery.id, { finalAttempt: false });
    expect(gateway.provider.sent).toHaveLength(1);
  });

  it('un contacto suprimido o dado de baja no recibe el correo', async () => {
    const { delivery } = await oneQueued();
    deliveries.ineligible.add(delivery.contactId);
    await sender().execute(systemCtx, delivery.id, { finalAttempt: false });
    expect(gateway.provider.sent).toHaveLength(0);
    expect(deliveries.deliveries.get(delivery.id)?.status).toBe('SUPPRESSED');
  });

  it('en pausa la entrega queda en cola y en una campaña cancelada se cancela', async () => {
    const { campaign, delivery } = await oneQueued({ status: 'PAUSED' });
    await sender().execute(systemCtx, delivery.id, { finalAttempt: false });
    expect(deliveries.deliveries.get(delivery.id)?.status).toBe('QUEUED');
    campaigns.campaigns.set(campaign.id, {
      ...campaigns.campaigns.get(campaign.id)!,
      status: 'CANCELLED',
    });
    await sender().execute(systemCtx, delivery.id, { finalAttempt: false });
    expect(deliveries.deliveries.get(delivery.id)?.status).toBe('CANCELLED');
  });

  it('si se alcanza el límite del proveedor pide reprogramar sin consumir la entrega', async () => {
    const { delivery } = await oneQueued();
    throttle.result = { ok: false, retryAfterMs: 750 };
    expect(await sender().execute(systemCtx, delivery.id, { finalAttempt: false })).toEqual({
      type: 'delay',
      delayMs: 750,
    });
    expect(deliveries.deliveries.get(delivery.id)).toMatchObject({ status: 'QUEUED', attempts: 0 });
    expect(throttle.scopes).toEqual([`provider:${PROVIDER_ID}`]);
  });

  it('pide un ritmo uniforme al proveedor y, si lo tiene, su cupo diario', async () => {
    gateway.rateLimitPerSecond = 0.5;
    gateway.maxPerDay = 10_000;
    const { delivery } = await oneQueued();
    await sender().execute(systemCtx, delivery.id, { finalAttempt: false });
    expect(throttle.limits[0]).toEqual([
      { mode: 'rate', points: 0.5, durationSeconds: 1 },
      { mode: 'quota', points: 10_000, durationSeconds: 86_400 },
    ]);
  });

  it('un error de autenticación marca el proveedor con error y pausa la campaña (circuit breaker)', async () => {
    const { campaign, delivery } = await oneQueued();
    gateway.provider.results = [
      { ok: false, code: 'AUTH', retryable: false, message: '535 auth failed' },
    ];
    await sender().execute(systemCtx, delivery.id, { finalAttempt: false });
    expect(providers.providers.get(PROVIDER_ID)?.status).toBe('ERROR');
    expect(campaigns.campaigns.get(campaign.id)).toMatchObject({
      status: 'PAUSED',
      error: 'PROVIDER_ERROR',
    });
    expect(deliveries.deliveries.get(delivery.id)?.status).toBe('QUEUED');
  });

  it('un error transitorio se reintenta y en el último intento queda FAILED', async () => {
    const { delivery } = await oneQueued();
    gateway.provider.results = [
      { ok: false, code: 'TRANSIENT', retryable: true, message: 'timeout' },
      { ok: false, code: 'TRANSIENT', retryable: true, message: 'timeout' },
    ];
    await expect(
      sender().execute(systemCtx, delivery.id, { finalAttempt: false }),
    ).rejects.toBeInstanceOf(TransientSendError);
    expect(deliveries.deliveries.get(delivery.id)?.status).toBe('QUEUED');
    await sender().execute(systemCtx, delivery.id, { finalAttempt: true });
    expect(deliveries.deliveries.get(delivery.id)).toMatchObject({ status: 'FAILED', attempts: 2 });
  });

  it('un destinatario inexistente queda FAILED y suprimido', async () => {
    const { delivery } = await oneQueued();
    gateway.provider.results = [
      { ok: false, code: 'INVALID_RECIPIENT', retryable: false, message: '550 no such user' },
    ];
    await sender().execute(systemCtx, delivery.id, { finalAttempt: false });
    expect(deliveries.deliveries.get(delivery.id)?.status).toBe('FAILED');
    expect(preferences.suppressed).toEqual([
      { contactId: delivery.contactId, reason: 'INVALID', source: 'provider' },
    ]);
  });

  it('usa el asunto B para la variante B', async () => {
    const campaign = campaigns.add(
      campaignRecord({
        status: 'SCHEDULED',
        version: 1,
        subjectB: 'Asunto B para {{ contact.first_name }}',
      }),
    );
    await dispatcher(new FakeAudience(recipients(40))).execute(systemCtx, campaign.id, 1);
    const variantB = [...deliveries.deliveries.values()].find((item) => item.variant === 'B')!;
    await sender().execute(systemCtx, variantB.id, { finalAttempt: false });
    expect(gateway.provider.sent[0]?.subject).toBe('Asunto B para Ana');
  });
});

describe('CampaignMaintenanceUseCase', () => {
  it('cierra campañas sin pendientes, recupera entregas colgadas y encola las programadas vencidas', async () => {
    const campaign = await dispatched(2);
    const [first, second] = [...deliveries.deliveries.values()];
    await sender().execute(systemCtx, first!.id, { finalAttempt: false });
    await deliveries.claim(systemCtx, second!.id, new Date(clock.now().getTime() - 20 * 60 * 1000));
    const due = campaigns.add(
      campaignRecord({
        status: 'SCHEDULED',
        scheduledAt: new Date('2026-10-01T00:00:00Z'),
        version: 4,
      }),
    );

    const maintenance = new CampaignMaintenanceUseCase({ campaigns, deliveries, queue, clock });
    expect(await maintenance.completeFinished()).toBe(0);
    expect(await maintenance.recoverStale()).toBe(1);
    expect(deliveries.deliveries.get(second!.id)?.status).toBe('QUEUED');
    await sender().execute(systemCtx, second!.id, { finalAttempt: false });
    expect(await maintenance.completeFinished()).toBe(1);
    expect(campaigns.campaigns.get(campaign.id)?.status).toBe('SENT');
    expect(await maintenance.enqueueDue()).toBe(1);
    expect(queue.dispatches.at(-1)).toEqual({ campaignId: due.id, version: 4, delayMs: 0 });
  });
});
