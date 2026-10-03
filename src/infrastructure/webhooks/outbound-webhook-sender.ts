/**
 * Envío de webhooks salientes firmados.
 *
 * Firma: `x-mcsn-signature: v1=<hex HMAC-SHA256(secreto, "{timestamp}.{cuerpo}")>`, con el
 * timestamp (segundos Unix) en `x-mcsn-timestamp`. El receptor debe recalcular la firma con el
 * cuerpo sin modificar, compararla en tiempo constante y rechazar timestamps de más de 5 minutos.
 *
 * El destino lo controla el tenant: la petición pasa por `safeFetch` (bloquea red privada,
 * metadatos de nube y DNS rebinding) y no sigue redirecciones.
 */
import { createHmac } from 'node:crypto';
import {
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookSender,
  type WebhookSendResult,
} from '@/core/webhooks/webhook';
import { SafeFetchError, safeFetch } from '../security/safe-fetch';

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export class SafeFetchWebhookSender implements WebhookSender {
  constructor(private readonly options: { allowPrivateHosts: boolean }) {}

  async send(
    url: string,
    body: string,
    secret: string,
    meta: { eventId: string; eventType: string; deliveryId: string; timestamp: number },
  ): Promise<WebhookSendResult> {
    try {
      const response = await safeFetch(url, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-mcsn-event': meta.eventType,
          'x-mcsn-event-id': meta.eventId,
          'x-mcsn-delivery': meta.deliveryId,
          'x-mcsn-timestamp': String(meta.timestamp),
          [WEBHOOK_SIGNATURE_HEADER]: signWebhook(secret, meta.timestamp, body),
        },
        timeoutMs: TIMEOUT_MS,
        maxBytes: MAX_RESPONSE_BYTES,
        maxRedirects: 0,
        allowPrivate: this.options.allowPrivateHosts,
        // En desarrollo (receptores locales) se admite cualquier puerto.
        ...(this.options.allowPrivateHosts ? { ports: 'any' as const } : {}),
      });
      return {
        status: response.status,
        error: response.status >= 200 && response.status < 300 ? null : `HTTP ${response.status}`,
      };
    } catch (error) {
      if (error instanceof SafeFetchError) return { status: null, error: error.code };
      return { status: null, error: 'NETWORK' };
    }
  }
}
