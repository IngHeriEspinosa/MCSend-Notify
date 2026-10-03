/**
 * Webhooks salientes: gestión de destinos (secreto mostrado una vez y cifrado con AAD),
 * publicación que nunca interrumpe el negocio y entrega con reintentos y desactivación automática.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { reversibleCipher } from '@tests/fakes/ai.fakes';
import { FakeClock, FakeTokenService, RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import { ownerContext, systemCtx, uuid } from '@tests/fakes/sending.fakes';
import {
  InMemoryWebhookDeliveryRepository,
  InMemoryWebhookEndpointRepository,
  RecordingWebhookQueue,
  ScriptedWebhookSender,
} from '@tests/fakes/webhook.fakes';
import type { TenantContext } from '@/core/shared/tenant-context';
import { MAX_WEBHOOK_ENDPOINTS, WEBHOOK_AUTO_DISABLE_AFTER, webhookSecretAad } from './webhook';
import {
  DeliverWebhookUseCase,
  isWebhookRetryError,
  ManageWebhooksUseCase,
  WebhookPublisher,
  type WebhookDeps,
} from './webhooks.use-cases';

let endpoints: InMemoryWebhookEndpointRepository;
let deliveries: InMemoryWebhookDeliveryRepository;
let queue: RecordingWebhookQueue;
let sender: ScriptedWebhookSender;
let audit: RecordingAuditLogger;
let clock: FakeClock;
let tokens: FakeTokenService;

function deps(overrides: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    endpoints,
    deliveries,
    queue,
    cipher: reversibleCipher,
    tokens,
    audit,
    clock,
    ids: { uuid },
    ...overrides,
  };
}

const manage = () => new ManageWebhooksUseCase(deps());
const deliver = () =>
  new DeliverWebhookUseCase({ endpoints, deliveries, sender, cipher: reversibleCipher, clock });

const editor: TenantContext = {
  ...ownerContext,
  actor: { type: 'user', userId: 'user-2', role: 'EDITOR', isPlatformAdmin: false },
};

async function endpoint(events: Array<'campaign.sent' | 'delivery.bounced'> = ['campaign.sent']) {
  return manage().create(ownerContext, {
    url: 'https://hooks.example.com/mcsn',
    description: null,
    events,
    enabled: true,
  });
}

beforeEach(() => {
  endpoints = new InMemoryWebhookEndpointRepository();
  deliveries = new InMemoryWebhookDeliveryRepository();
  queue = new RecordingWebhookQueue();
  sender = new ScriptedWebhookSender();
  audit = new RecordingAuditLogger();
  clock = new FakeClock();
  tokens = new FakeTokenService();
});

describe('gestión de destinos', () => {
  it('genera el secreto una sola vez, lo cifra con AAD por fila y audita', async () => {
    const { endpoint: created, secret } = await endpoint();
    expect(secret).toMatch(/^whsec_/);
    const stored = await endpoints.findById(ownerContext, created.id);
    expect(stored?.secretEnc).not.toBe(secret);
    expect(
      reversibleCipher.decrypt(
        stored?.secretEnc ?? '',
        webhookSecretAad(ownerContext.tenantId, created.id),
      ),
    ).toBe(secret);
    expect(created).not.toHaveProperty('secretEnc');
    expect(audit.entries.map((entry) => entry.action)).toEqual(['webhook.created']);
  });

  it('solo OWNER/ADMIN gestionan webhooks y hay un máximo de destinos', async () => {
    await expect(
      manage().create(editor, {
        url: 'https://hooks.example.com',
        description: null,
        events: ['campaign.sent'],
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    for (let index = 0; index < MAX_WEBHOOK_ENDPOINTS; index += 1) await endpoint();
    await expect(endpoint()).rejects.toMatchObject({ details: { reason: 'WEBHOOK_LIMIT' } });
  });

  it('rotar el secreto invalida el anterior', async () => {
    const { endpoint: created, secret } = await endpoint();
    const { secret: rotated } = await manage().rotateSecret(ownerContext, created.id);
    expect(rotated).not.toBe(secret);
    const stored = await endpoints.findById(ownerContext, created.id);
    expect(
      reversibleCipher.decrypt(
        stored?.secretEnc ?? '',
        webhookSecretAad(ownerContext.tenantId, created.id),
      ),
    ).toBe(rotated);
  });

  it('el evento de prueba se envía solo al destino elegido', async () => {
    const { endpoint: target } = await endpoint();
    await endpoint();
    await manage().sendTest(ownerContext, target.id);
    const [delivery] = [...deliveries.deliveries.values()];
    expect(deliveries.deliveries.size).toBe(1);
    expect(delivery).toMatchObject({ endpointId: target.id, eventType: 'webhook.test' });
    expect(queue.enqueued).toEqual([delivery?.id]);
  });
});

describe('publicación de eventos', () => {
  it('crea una entrega por destino suscrito y activo, con el mismo id de evento', async () => {
    const { endpoint: first } = await endpoint(['campaign.sent']);
    const { endpoint: second } = await endpoint(['campaign.sent', 'delivery.bounced']);
    await endpoint(['delivery.bounced']);
    const { endpoint: disabled } = await endpoint(['campaign.sent']);
    await endpoints.update(ownerContext, disabled.id, { enabled: false });

    await new WebhookPublisher(deps()).publish(systemCtx, 'campaign.sent', { campaignId: 'c-1' });

    const created = [...deliveries.deliveries.values()];
    expect(created.map((delivery) => delivery.endpointId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(new Set(created.map((delivery) => delivery.eventId)).size).toBe(1);
    expect(queue.enqueued).toHaveLength(2);
  });

  it('nunca lanza: un fallo se notifica por onError y el negocio continúa', async () => {
    const errors: string[] = [];
    const publisher = new WebhookPublisher(
      deps({
        endpoints: new (class extends InMemoryWebhookEndpointRepository {
          override async findSubscribed(): Promise<never> {
            throw new Error('BD caída');
          }
        })(),
        onError: (_error, _context, type) => errors.push(type),
      }),
    );
    await expect(
      publisher.publish(systemCtx, 'delivery.bounced', { deliveryId: 'd-1' }),
    ).resolves.toBeUndefined();
    expect(errors).toEqual(['delivery.bounced']);
  });
});

describe('entrega', () => {
  async function pendingDelivery() {
    const { endpoint: created, secret } = await endpoint();
    await new WebhookPublisher(deps()).publish(systemCtx, 'campaign.sent', { campaignId: 'c-1' });
    const [delivery] = [...deliveries.deliveries.values()];
    if (!delivery) throw new Error('sin entrega');
    return { endpointId: created.id, secret, delivery };
  }

  it('2xx: envía el sobre firmado con el secreto descifrado y marca la entrega', async () => {
    const { secret, delivery, endpointId } = await pendingDelivery();
    await deliver().execute(systemCtx, delivery.id, { attempt: 1, finalAttempt: false });

    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.secret).toBe(secret);
    expect(JSON.parse(sender.calls[0]?.body ?? '{}')).toEqual({
      id: delivery.eventId,
      type: 'campaign.sent',
      createdAt: delivery.createdAt.toISOString(),
      tenant: 'mcsupport',
      data: { campaignId: 'c-1' },
    });
    expect(deliveries.deliveries.get(delivery.id)).toMatchObject({
      status: 'SUCCEEDED',
      attempts: 1,
      responseStatus: 200,
    });
    expect((await endpoints.findById(systemCtx, endpointId))?.lastStatus).toBe(200);

    // Un job repetido no vuelve a enviar una entrega ya resuelta.
    await deliver().execute(systemCtx, delivery.id, { attempt: 2, finalAttempt: false });
    expect(sender.calls).toHaveLength(1);
  });

  it('error con intentos restantes: queda pendiente y pide reintento', async () => {
    const { delivery } = await pendingDelivery();
    sender.result = { status: 503, error: 'HTTP 503' };
    const failure = deliver().execute(systemCtx, delivery.id, { attempt: 1, finalAttempt: false });
    await expect(failure).rejects.toSatisfy(isWebhookRetryError);
    expect(deliveries.deliveries.get(delivery.id)).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      error: 'HTTP 503',
    });
  });

  it('último intento fallido: FAILED y, tras 20 fallos seguidos, el destino se desactiva', async () => {
    const { delivery, endpointId } = await pendingDelivery();
    sender.result = { status: null, error: 'TIMEOUT' };
    await deliver().execute(systemCtx, delivery.id, { attempt: 8, finalAttempt: true });
    expect(deliveries.deliveries.get(delivery.id)).toMatchObject({
      status: 'FAILED',
      error: 'TIMEOUT',
    });
    expect((await endpoints.findById(systemCtx, endpointId))?.failureCount).toBe(1);

    for (let index = 1; index < WEBHOOK_AUTO_DISABLE_AFTER; index += 1) {
      await endpoints.recordResult(systemCtx, endpointId, {
        ok: false,
        status: null,
        error: 'TIMEOUT',
        at: clock.now(),
        disableAfter: WEBHOOK_AUTO_DISABLE_AFTER,
      });
    }
    expect((await endpoints.findById(systemCtx, endpointId))?.enabled).toBe(false);
  });

  it('destino desactivado: la entrega pendiente falla sin enviarse', async () => {
    const { delivery, endpointId } = await pendingDelivery();
    await endpoints.update(ownerContext, endpointId, { enabled: false });
    await deliver().execute(systemCtx, delivery.id, { attempt: 1, finalAttempt: false });
    expect(sender.calls).toEqual([]);
    expect(deliveries.deliveries.get(delivery.id)).toMatchObject({
      status: 'FAILED',
      error: 'ENDPOINT_DISABLED',
    });
  });
});
