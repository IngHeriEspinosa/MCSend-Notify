import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryBrandingRepository } from '@tests/fakes/content.fakes';
import { FakeClock } from '@tests/fakes/identity.fakes';
import {
  campaignRecord,
  FakePreferences,
  fakeTrackingLinks,
  InMemoryCampaignRepository,
  InMemoryDeliveryRepository,
  InMemoryProviderRepository,
  PROVIDER_ID,
  storedProvider,
  systemCtx,
  TENANT_ID,
  TOPIC_ID,
} from '@tests/fakes/sending.fakes';
import type { SecretCipher } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  ApplyProviderEventUseCase,
  IngestProviderWebhookUseCase,
  type InboundEventRepository,
  type NormalizedProviderEvent,
  type ProviderWebhookParser,
  type StoredProviderEvent,
} from './provider-events.use-cases';
import { TrackingUseCase } from './tracking.use-cases';

let campaigns: InMemoryCampaignRepository;
let deliveries: InMemoryDeliveryRepository;
let preferences: FakePreferences;
let tracking: TrackingUseCase;
let deliveryId: string;
let campaignId: string;

const HUMAN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36';

beforeEach(async () => {
  campaigns = new InMemoryCampaignRepository();
  deliveries = new InMemoryDeliveryRepository();
  preferences = new FakePreferences();
  const campaign = campaigns.add(campaignRecord({ status: 'SENDING' }));
  campaignId = campaign.id;
  await campaigns.saveCompiled(
    systemCtx,
    campaign.id,
    { subject: 's', subjectB: null, html: 'h', text: 't' },
    ['https://multicomputos.com', 'https://app.test/trk/d/documento'],
  );
  await deliveries.createBatch(systemCtx, campaign.id, PROVIDER_ID, [
    { contactId: 'contact-1', email: 'ana@cliente.com', variant: null },
  ]);
  deliveryId = [...deliveries.deliveries.keys()][0] ?? '';
  await deliveries.claim(systemCtx, deliveryId, new Date());
  await deliveries.markSent(systemCtx, deliveryId, 'provider-msg-1', new Date());
  tracking = new TrackingUseCase({
    campaigns,
    deliveries,
    preferences,
    links: fakeTrackingLinks,
    branding: new InMemoryBrandingRepository(),
    clock: new FakeClock(),
  });
});

describe('TrackingUseCase', () => {
  it('distingue la apertura automática de la humana', async () => {
    await tracking.open(TENANT_ID, deliveryId, { userAgent: 'Mozilla/5.0' });
    expect(deliveries.deliveries.get(deliveryId)).toMatchObject({
      machineOpenOnly: true,
      openCount: 1,
    });
    await tracking.open(TENANT_ID, deliveryId, { userAgent: HUMAN });
    expect(deliveries.deliveries.get(deliveryId)).toMatchObject({
      machineOpenOnly: false,
      openCount: 2,
    });
    expect(
      deliveries.events.filter((event) => event.type === 'OPENED').map((event) => event.isBot),
    ).toEqual([true, false]);
  });

  it('el clic devuelve la URL guardada, implica apertura y registra la descarga de documentos', async () => {
    expect(
      await tracking.click(TENANT_ID, deliveryId, 'link-1', { userAgent: HUMAN, method: 'GET' }),
    ).toBe('https://app.test/trk/d/documento');
    expect(deliveries.deliveries.get(deliveryId)).toMatchObject({ clickCount: 1 });
    expect(deliveries.deliveries.get(deliveryId)?.firstOpenedAt).not.toBeNull();
    expect(deliveries.events.map((event) => event.type)).toEqual(['CLICKED', 'DOWNLOADED']);
  });

  it('los escáneres de enlaces no cuentan como clic y un enlace ajeno no redirige', async () => {
    await tracking.click(TENANT_ID, deliveryId, 'link-0', {
      userAgent: 'Microsoft Office Safe Links',
      method: 'GET',
    });
    expect(deliveries.deliveries.get(deliveryId)?.clickCount).toBe(0);
    expect(deliveries.events[0]?.isBot).toBe(true);
    expect(await tracking.click(TENANT_ID, deliveryId, 'link-99', { userAgent: HUMAN })).toBeNull();
  });

  it('la baja con un clic sin tema suprime al contacto en todo el tenant', async () => {
    expect(await tracking.unsubscribe(TENANT_ID, deliveryId, {})).toBe(true);
    expect(preferences.suppressed).toEqual([
      { contactId: 'contact-1', reason: 'UNSUBSCRIBE', source: 'unsubscribe' },
    ]);
    expect(deliveries.deliveries.get(deliveryId)?.unsubscribedAt).not.toBeNull();
  });

  it('con tema, la baja con un clic solo afecta a ese tema', async () => {
    campaigns.campaigns.set(campaignId, {
      ...campaigns.campaigns.get(campaignId)!,
      topicId: TOPIC_ID,
    });
    await tracking.unsubscribe(TENANT_ID, deliveryId, {});
    expect(preferences.topics.get(TOPIC_ID)).toBe(false);
    expect(preferences.suppressed).toEqual([]);
  });

  it('el centro de preferencias enmascara el email y aplica los cambios', async () => {
    const view = await tracking.preferences(TENANT_ID, deliveryId);
    expect(view).toMatchObject({
      email: 'a***@cliente.com',
      tenantName: 'MCSupport',
      locale: 'es',
    });
    await tracking.updatePreferences(TENANT_ID, deliveryId, {
      unsubscribeAll: false,
      topics: { [TOPIC_ID]: false, 'otro-tema': false },
    });
    expect(preferences.topics.get(TOPIC_ID)).toBe(false);
    expect(preferences.topics.has('otro-tema')).toBe(false);
    expect(await tracking.preferences(TENANT_ID, 'inexistente')).toBeNull();
  });
});

class InMemoryInboundEvents implements InboundEventRepository {
  readonly events = new Map<string, StoredProviderEvent>();
  async insert(_context: TenantContext, providerConfigId: string, event: NormalizedProviderEvent) {
    if ([...this.events.values()].some((item) => item.providerEventId === event.providerEventId))
      return null;
    const id = `event-${this.events.size + 1}`;
    this.events.set(id, { ...event, id, providerConfigId, processedAt: null });
    return id;
  }
  async findById(_context: TenantContext, id: string) {
    return this.events.get(id) ?? null;
  }
  async markProcessed(_context: TenantContext, id: string, at: Date) {
    const event = this.events.get(id);
    if (event) this.events.set(id, { ...event, processedAt: at });
  }
}

const identityCipher: SecretCipher = { encrypt: (value) => value, decrypt: (value) => value };

describe('eventos de proveedores', () => {
  it('ingiere eventos firmados deduplicando los reintentos del proveedor', async () => {
    const providers = new InMemoryProviderRepository();
    providers.providers.set(
      PROVIDER_ID,
      storedProvider({ kind: 'RESEND', credentialsEnc: '{"webhookSecret":"whsec_x"}' }),
    );
    const events = new InMemoryInboundEvents();
    const enqueued: string[] = [];
    const event: NormalizedProviderEvent = {
      providerEventId: 'svix-1',
      providerMessageId: 'provider-msg-1',
      type: 'HARD_BOUNCE',
      occurredAt: new Date(),
    };
    const parser: ProviderWebhookParser = {
      parse: async () => ({ kind: 'events', events: [event] }),
      confirmSubscription: async () => {},
    };
    const ingest = new IngestProviderWebhookUseCase({
      providers,
      cipher: identityCipher,
      parser,
      events,
      queue: { enqueue: async (_context, id) => void enqueued.push(id) },
    });
    expect(await ingest.execute('token-endpoint-1234567890', { headers: {}, body: '{}' })).toEqual({
      accepted: 1,
    });
    expect(await ingest.execute('token-endpoint-1234567890', { headers: {}, body: '{}' })).toEqual({
      accepted: 0,
    });
    expect(enqueued).toEqual(['event-1']);
    await expect(ingest.execute('desconocido', { headers: {}, body: '{}' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('un rebote permanente marca la entrega y suprime al contacto; un evento tardío no la hace retroceder', async () => {
    const events = new InMemoryInboundEvents();
    const apply = new ApplyProviderEventUseCase({
      events,
      deliveries,
      preferences,
      clock: new FakeClock(),
    });
    const bounce = await events.insert(systemCtx, PROVIDER_ID, {
      providerEventId: 'e1',
      providerMessageId: 'provider-msg-1',
      type: 'HARD_BOUNCE',
      occurredAt: new Date(),
    });
    const delivered = await events.insert(systemCtx, PROVIDER_ID, {
      providerEventId: 'e2',
      providerMessageId: 'provider-msg-1',
      type: 'DELIVERED',
      occurredAt: new Date(),
    });
    await apply.execute(systemCtx, bounce!);
    await apply.execute(systemCtx, delivered!);
    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('BOUNCED');
    expect(preferences.suppressed).toEqual([
      { contactId: 'contact-1', reason: 'HARD_BOUNCE', source: 'provider' },
    ]);
    expect(deliveries.events.map((event) => event.type)).toEqual(['BOUNCED']);
    expect(events.events.get(delivered!)?.processedAt).not.toBeNull();
  });

  it('una queja suprime al contacto y un mensaje desconocido solo se marca como procesado', async () => {
    const events = new InMemoryInboundEvents();
    const apply = new ApplyProviderEventUseCase({
      events,
      deliveries,
      preferences,
      clock: new FakeClock(),
    });
    const complaint = await events.insert(systemCtx, PROVIDER_ID, {
      providerEventId: 'c1',
      providerMessageId: 'provider-msg-1',
      type: 'COMPLAINT',
      occurredAt: new Date(),
    });
    const unknown = await events.insert(systemCtx, PROVIDER_ID, {
      providerEventId: 'c2',
      providerMessageId: 'otro',
      type: 'COMPLAINT',
      occurredAt: new Date(),
    });
    await apply.execute(systemCtx, complaint!);
    await apply.execute(systemCtx, unknown!);
    expect(deliveries.deliveries.get(deliveryId)?.status).toBe('COMPLAINED');
    expect(preferences.suppressed.map((item) => item.reason)).toEqual(['COMPLAINT']);
    expect(events.events.get(unknown!)?.processedAt).not.toBeNull();
  });
});
