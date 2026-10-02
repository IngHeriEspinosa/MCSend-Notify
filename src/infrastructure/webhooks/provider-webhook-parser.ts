/**
 * Verificación y normalización de webhooks de proveedores.
 *
 * - Resend (Svix): HMAC-SHA256 de `{svix-id}.{svix-timestamp}.{cuerpo}` con el secreto `whsec_`,
 *   tolerancia de 5 minutos (anti-replay) y comparación en tiempo constante.
 * - Amazon SES vía SNS: firma RSA (v1 SHA1, v2 SHA256) del mensaje canónico con el certificado de
 *   `SigningCertURL`, que solo se descarga si el host es `sns.{región}.amazonaws.com` por https
 *   (evita SSRF y certificados falsos). La confirmación de suscripción valida el mismo host.
 */
import { createHmac, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import type {
  NormalizedProviderEvent,
  ParsedWebhook,
  ProviderWebhookParser,
  WebhookRequest,
} from '@/core/campaigns/use-cases/provider-events.use-cases';
import type { EmailProviderKind } from '@/core/providers/provider-config';
import { DomainError } from '@/core/shared/domain-error';

const TOLERANCE_MS = 5 * 60 * 1000;
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

function forbidden(message: string): never {
  throw new DomainError('FORBIDDEN', message);
}

export function verifySvixSignature(secret: string, request: WebhookRequest, now: number): string {
  const id = request.headers['svix-id'];
  const timestamp = request.headers['svix-timestamp'];
  const signatures = request.headers['svix-signature'];
  if (!id || !timestamp || !signatures) forbidden('Faltan las cabeceras de firma');
  if (Math.abs(now - Number(timestamp) * 1000) > TOLERANCE_MS) forbidden('Firma fuera de plazo');
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${request.body}`).digest();
  const valid = signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    const received = Buffer.from(value, 'base64');
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
  if (!valid) forbidden('Firma inválida');
  return id;
}

const resendEventSchema = z.object({
  type: z.string(),
  created_at: z.string(),
  data: z.object({
    email_id: z.string(),
    bounce: z
      .object({ type: z.string().optional(), message: z.string().optional() })
      .partial()
      .optional(),
  }),
});

function normalizeResend(eventId: string, body: string): NormalizedProviderEvent[] {
  const event = resendEventSchema.parse(JSON.parse(body));
  const base = {
    providerEventId: eventId,
    providerMessageId: event.data.email_id,
    occurredAt: new Date(event.created_at),
  };
  switch (event.type) {
    case 'email.delivered':
      return [{ ...base, type: 'DELIVERED' }];
    case 'email.bounced':
      return [
        {
          ...base,
          type:
            event.data.bounce?.type?.toLowerCase() === 'transient' ? 'SOFT_BOUNCE' : 'HARD_BOUNCE',
          detail: event.data.bounce?.message?.slice(0, 300),
        },
      ];
    case 'email.complained':
      return [{ ...base, type: 'COMPLAINT' }];
    default:
      return [];
  }
}

const snsEnvelopeSchema = z.object({
  Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
  MessageId: z.string(),
  TopicArn: z.string(),
  Message: z.string(),
  Timestamp: z.string(),
  SignatureVersion: z.enum(['1', '2']),
  Signature: z.string(),
  SigningCertURL: z.string(),
  Subject: z.string().optional(),
  SubscribeURL: z.string().optional(),
  Token: z.string().optional(),
});
type SnsEnvelope = z.infer<typeof snsEnvelopeSchema>;

export function isTrustedSnsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && SNS_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

/** Cadena canónica que firma SNS (campos en orden alfabético, cada uno con su valor). */
export function snsStringToSign(envelope: Readonly<Record<string, string | undefined>>): string {
  const fields =
    envelope.Type === 'Notification'
      ? [
          'Message',
          'MessageId',
          ...(envelope.Subject ? ['Subject'] : []),
          'Timestamp',
          'TopicArn',
          'Type',
        ]
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields.map((field) => `${field}\n${envelope[field] ?? ''}\n`).join('');
}

const sesMessageSchema = z.object({
  eventType: z.string().optional(),
  notificationType: z.string().optional(),
  mail: z.object({ messageId: z.string(), timestamp: z.string() }),
  bounce: z.object({ bounceType: z.string() }).partial().optional(),
});

function normalizeSes(envelope: SnsEnvelope): NormalizedProviderEvent[] {
  const message = sesMessageSchema.parse(JSON.parse(envelope.Message));
  const kind = message.eventType ?? message.notificationType;
  const base = {
    providerEventId: envelope.MessageId,
    providerMessageId: message.mail.messageId,
    occurredAt: new Date(envelope.Timestamp),
  };
  switch (kind) {
    case 'Delivery':
      return [{ ...base, type: 'DELIVERED' }];
    case 'Bounce':
      return [
        {
          ...base,
          type: message.bounce?.bounceType === 'Permanent' ? 'HARD_BOUNCE' : 'SOFT_BOUNCE',
        },
      ];
    case 'Complaint':
      return [{ ...base, type: 'COMPLAINT' }];
    default:
      return [];
  }
}

export type CertificateFetcher = (url: string) => Promise<string>;

async function fetchCertificate(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok) throw new Error(`No se pudo descargar el certificado SNS (${response.status})`);
  return response.text();
}

export class DefaultProviderWebhookParser implements ProviderWebhookParser {
  private readonly certificates = new Map<string, string>();

  constructor(
    private readonly options: {
      fetchCertificate?: CertificateFetcher;
      now?: () => number;
      fetchImpl?: typeof fetch;
    } = {},
  ) {}

  async parse(
    kind: EmailProviderKind,
    credentials: unknown,
    request: WebhookRequest,
  ): Promise<ParsedWebhook> {
    if (kind === 'RESEND') {
      const secret = z
        .object({ webhookSecret: z.string().nullable() })
        .parse(credentials).webhookSecret;
      if (!secret) forbidden('El proveedor no tiene secreto de webhook');
      const eventId = verifySvixSignature(secret, request, (this.options.now ?? Date.now)());
      return { kind: 'events', events: normalizeResend(eventId, request.body) };
    }
    if (kind === 'SES') {
      const parsed = snsEnvelopeSchema.safeParse(JSON.parse(request.body));
      if (!parsed.success) forbidden('Mensaje SNS inválido');
      const envelope = parsed.data;
      await this.verifySns(envelope);
      if (envelope.Type === 'SubscriptionConfirmation') {
        if (!isTrustedSnsUrl(envelope.SubscribeURL)) forbidden('URL de suscripción no confiable');
        return { kind: 'subscription', confirmUrl: envelope.SubscribeURL ?? '' };
      }
      return {
        kind: 'events',
        events: envelope.Type === 'Notification' ? normalizeSes(envelope) : [],
      };
    }
    forbidden('El proveedor no admite webhooks');
  }

  async confirmSubscription(confirmUrl: string): Promise<void> {
    if (!isTrustedSnsUrl(confirmUrl)) forbidden('URL de suscripción no confiable');
    const response = await (this.options.fetchImpl ?? fetch)(confirmUrl, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Confirmación SNS rechazada (${response.status})`);
  }

  private async verifySns(envelope: SnsEnvelope): Promise<void> {
    if (!isTrustedSnsUrl(envelope.SigningCertURL)) forbidden('Certificado SNS no confiable');
    let certificate = this.certificates.get(envelope.SigningCertURL);
    if (!certificate) {
      certificate = await (this.options.fetchCertificate ?? fetchCertificate)(
        envelope.SigningCertURL,
      );
      this.certificates.set(envelope.SigningCertURL, certificate);
    }
    const valid = verifySignature(
      envelope.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256',
      Buffer.from(snsStringToSign(envelope), 'utf8'),
      certificate,
      Buffer.from(envelope.Signature, 'base64'),
    );
    if (!valid) forbidden('Firma SNS inválida');
  }
}
