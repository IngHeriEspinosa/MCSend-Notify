import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DefaultProviderWebhookParser,
  isTrustedSnsUrl,
  snsStringToSign,
  verifySvixSignature,
} from './provider-webhook-parser';

const SECRET_BYTES = Buffer.from('clave-de-webhook-de-pruebas-1234567890');
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;
const NOW = Date.parse('2026-10-02T12:00:00Z');

function svixRequest(body: string, options: { secret?: Buffer; timestamp?: number } = {}) {
  const id = 'msg_2abc';
  const timestamp = String(Math.floor((options.timestamp ?? NOW) / 1000));
  const signature = createHmac('sha256', options.secret ?? SECRET_BYTES)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return {
    headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
    body,
  };
}

const resendBounce = JSON.stringify({
  type: 'email.bounced',
  created_at: '2026-10-02T11:59:00Z',
  data: { email_id: 're-123', bounce: { type: 'Permanent', message: 'Mailbox does not exist' } },
});

describe('Resend (Svix)', () => {
  const parser = new DefaultProviderWebhookParser({ now: () => NOW });

  it('acepta una firma válida y normaliza el rebote permanente', async () => {
    const parsed = await parser.parse(
      'RESEND',
      { apiKey: 're_x', webhookSecret: SECRET },
      svixRequest(resendBounce),
    );
    expect(parsed).toEqual({
      kind: 'events',
      events: [
        {
          providerEventId: 'msg_2abc',
          providerMessageId: 're-123',
          type: 'HARD_BOUNCE',
          occurredAt: new Date('2026-10-02T11:59:00Z'),
          detail: 'Mailbox does not exist',
        },
      ],
    });
  });

  it('rechaza firmas de otro secreto, cuerpos alterados y mensajes fuera de plazo', () => {
    expect(() =>
      verifySvixSignature(SECRET, svixRequest(resendBounce, { secret: Buffer.from('otra') }), NOW),
    ).toThrow();
    const request = svixRequest(resendBounce);
    expect(() =>
      verifySvixSignature(SECRET, { ...request, body: `${request.body} ` }, NOW),
    ).toThrow();
    expect(() =>
      verifySvixSignature(
        SECRET,
        svixRequest(resendBounce, { timestamp: NOW - 10 * 60 * 1000 }),
        NOW,
      ),
    ).toThrow();
  });

  it('un rebote temporal no es permanente y los tipos desconocidos se ignoran', async () => {
    const soft = resendBounce.replace('Permanent', 'Transient');
    const parsed = await parser.parse('RESEND', { webhookSecret: SECRET }, svixRequest(soft));
    expect(parsed.kind === 'events' && parsed.events[0]?.type).toBe('SOFT_BOUNCE');
    const opened = JSON.stringify({
      type: 'email.opened',
      created_at: '2026-10-02T11:59:00Z',
      data: { email_id: 'x' },
    });
    const ignored = await parser.parse('RESEND', { webhookSecret: SECRET }, svixRequest(opened));
    expect(ignored).toEqual({ kind: 'events', events: [] });
  });
});

describe('Amazon SES vía SNS', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const certUrl = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem';
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  function signedEnvelope<T extends Record<string, string>>(fields: T, version: '1' | '2' = '2') {
    const envelope = {
      SignatureVersion: version,
      SigningCertURL: certUrl,
      Signature: '',
      ...fields,
    };
    const signer = createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
    signer.update(snsStringToSign(envelope));
    return { ...envelope, Signature: signer.sign(privateKey, 'base64') };
  }

  const notification = (sesMessage: object, version: '1' | '2' = '2') =>
    signedEnvelope(
      {
        Type: 'Notification',
        MessageId: 'sns-1',
        TopicArn: 'arn:aws:sns:us-east-1:123:ses-events',
        Message: JSON.stringify(sesMessage),
        Timestamp: '2026-10-02T12:00:00.000Z',
      },
      version,
    );

  const parser = new DefaultProviderWebhookParser({ fetchCertificate: async () => publicPem });

  it.each(['1', '2'] as const)(
    'verifica la firma (versión %s) y normaliza la queja',
    async (version) => {
      const body = JSON.stringify(
        notification(
          { eventType: 'Complaint', mail: { messageId: 'ses-9', timestamp: 'x' } },
          version,
        ),
      );
      const parsed = await parser.parse('SES', {}, { headers: {}, body });
      expect(parsed.kind === 'events' && parsed.events[0]).toMatchObject({
        type: 'COMPLAINT',
        providerMessageId: 'ses-9',
      });
    },
  );

  it('rechaza mensajes alterados y certificados fuera de amazonaws.com', async () => {
    const envelope = notification({
      eventType: 'Bounce',
      bounce: { bounceType: 'Permanent' },
      mail: { messageId: 'm', timestamp: 'x' },
    });
    const altered = { ...envelope, Message: envelope.Message.replace('Permanent', 'Transient') };
    await expect(
      parser.parse('SES', {}, { headers: {}, body: JSON.stringify(altered) }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const evil = { ...envelope, SigningCertURL: 'https://evil.example/cert.pem' };
    await expect(
      parser.parse('SES', {}, { headers: {}, body: JSON.stringify(evil) }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('devuelve la confirmación de suscripción solo con URL de SNS', async () => {
    const confirmation = signedEnvelope({
      Type: 'SubscriptionConfirmation',
      MessageId: 'sns-2',
      TopicArn: 'arn:aws:sns:us-east-1:123:ses-events',
      Message: 'Confirm',
      Timestamp: '2026-10-02T12:00:00.000Z',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc',
      Token: 'abc',
    });
    const parsed = await parser.parse(
      'SES',
      {},
      { headers: {}, body: JSON.stringify(confirmation) },
    );
    expect(parsed).toEqual({ kind: 'subscription', confirmUrl: confirmation.SubscribeURL });
    expect(isTrustedSnsUrl('http://sns.us-east-1.amazonaws.com/x')).toBe(false);
    expect(isTrustedSnsUrl('https://sns.us-east-1.amazonaws.com.evil.test/x')).toBe(false);
  });
});
