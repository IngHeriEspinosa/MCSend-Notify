import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SafeFetchWebhookSender, signWebhook } from './outbound-webhook-sender';

let server: Server;
let base: string;
const received: Array<{ headers: IncomingHttpHeaders; body: string }> = [];

const META = {
  eventId: 'evt-1',
  eventType: 'campaign.sent',
  deliveryId: 'dlv-1',
  timestamp: 1_790_000_000,
};

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      received.push({ headers: request.headers, body });
      if (request.url === '/fail') response.statusCode = 500;
      if (request.url === '/redirect') {
        response.statusCode = 302;
        response.setHeader('location', '/ok');
      }
      response.end('ok');
    });
  });
  base = await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Verificación tal como la haría un receptor (documentada en la guía de webhooks). */
function verify(secret: string, headers: IncomingHttpHeaders, body: string): boolean {
  const expected = Buffer.from(
    'v1=' +
      createHmac('sha256', secret)
        .update(`${String(headers['x-mcsn-timestamp'])}.${body}`)
        .digest('hex'),
  );
  const actual = Buffer.from(String(headers['x-mcsn-signature']));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

describe('firma de webhooks', () => {
  it('HMAC-SHA256 hex de "timestamp.cuerpo" con prefijo de versión', () => {
    expect(signWebhook('whsec_test', 1_790_000_000, '{"a":1}')).toBe(
      'v1=' + createHmac('sha256', 'whsec_test').update('1790000000.{"a":1}').digest('hex'),
    );
    expect(signWebhook('otro', 1_790_000_000, '{"a":1}')).not.toBe(
      signWebhook('whsec_test', 1_790_000_000, '{"a":1}'),
    );
  });
});

describe('SafeFetchWebhookSender', () => {
  const local = new SafeFetchWebhookSender({ allowPrivateHosts: true });

  it('envía el JSON con cabeceras de evento y una firma verificable', async () => {
    const body = JSON.stringify({ id: 'evt-1', type: 'campaign.sent', data: { n: 1 } });
    const result = await local.send(`${base}/ok`, body, 'whsec_test', META);

    expect(result).toEqual({ status: 200, error: null });
    const last = received.at(-1);
    expect(last?.body).toBe(body);
    expect(last?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-mcsn-event': 'campaign.sent',
      'x-mcsn-event-id': 'evt-1',
      'x-mcsn-delivery': 'dlv-1',
      'x-mcsn-timestamp': '1790000000',
    });
    expect(verify('whsec_test', last?.headers ?? {}, body)).toBe(true);
    expect(verify('whsec_otro', last?.headers ?? {}, body)).toBe(false);
  });

  it('una respuesta no 2xx se informa como error HTTP', async () => {
    await expect(local.send(`${base}/fail`, '{}', 's', META)).resolves.toEqual({
      status: 500,
      error: 'HTTP 500',
    });
  });

  it('no sigue redirecciones', async () => {
    const before = received.length;
    await expect(local.send(`${base}/redirect`, '{}', 's', META)).resolves.toEqual({
      status: null,
      error: 'REDIRECTS',
    });
    expect(received.length).toBe(before + 1);
  });

  it('bloquea destinos privados en producción (SSRF)', async () => {
    const before = received.length;
    const strict = new SafeFetchWebhookSender({ allowPrivateHosts: false });
    await expect(strict.send(`${base}/ok`, '{}', 's', META)).resolves.toEqual({
      status: null,
      error: 'BLOCKED',
    });
    expect(received.length).toBe(before);
  });
});
