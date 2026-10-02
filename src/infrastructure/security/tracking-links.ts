/**
 * URL de seguimiento firmadas con HMAC-SHA256 (dominio `mcsn-track-v1`, distinto del de recursos
 * públicos): apertura (`/trk/o`), clic (`/trk/c`), baja (`/trk/u`) y preferencias.
 * La carga lleva solo identificadores; el destino de un clic se lee de la base de datos.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { TrackingLinks } from '@/core/campaigns/ports';

const DOMAIN = 'mcsn-track-v1';
const SIGNATURE_BYTES = 16;

const payloadSchema = z.object({
  p: z.enum(['o', 'c', 'u']),
  t: z.uuid(),
  d: z.uuid(),
  l: z.uuid().optional(),
});

export type TrackingPayload = z.infer<typeof payloadSchema>;

export class HmacTrackingLinks implements TrackingLinks {
  private readonly baseUrl: string;

  constructor(
    private readonly secret: string,
    baseUrl: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  openUrl(tenantId: string, deliveryId: string): string {
    return `${this.baseUrl}/trk/o/${this.sign({ p: 'o', t: tenantId, d: deliveryId })}`;
  }

  clickUrl(tenantId: string, deliveryId: string, linkId: string): string {
    return `${this.baseUrl}/trk/c/${this.sign({ p: 'c', t: tenantId, d: deliveryId, l: linkId })}`;
  }

  unsubscribeUrl(tenantId: string, deliveryId: string): string {
    return `${this.baseUrl}/trk/u/${this.sign({ p: 'u', t: tenantId, d: deliveryId })}`;
  }

  /** El centro de preferencias usa el mismo token de baja (misma entrega, mismo propósito). */
  preferencesUrl(tenantId: string, deliveryId: string): string {
    return this.unsubscribeUrl(tenantId, deliveryId);
  }

  isDocumentDownload(url: string): boolean {
    return url.startsWith(`${this.baseUrl}/trk/d/`);
  }

  verify(token: string, purpose: TrackingPayload['p']): TrackingPayload | null {
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra !== undefined || token.length > 1024) return null;
    const expected = this.signature(encoded);
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    try {
      const parsed = payloadSchema.safeParse(
        JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
      );
      return parsed.success && parsed.data.p === purpose ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private sign(payload: TrackingPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${encoded}.${this.signature(encoded).toString('base64url')}`;
  }

  private signature(encoded: string): Buffer {
    return createHmac('sha256', this.secret)
      .update(`${DOMAIN}.${encoded}`)
      .digest()
      .subarray(0, SIGNATURE_BYTES);
  }
}

/** Huella de la IP con sal diaria: permite agrupar sin almacenar la dirección (privacidad). */
export function hashIp(secret: string, ip: string | undefined, day: string): string | undefined {
  if (!ip) return undefined;
  return createHmac('sha256', secret).update(`ip.${day}.${ip}`).digest('base64url').slice(0, 22);
}
