/**
 * URL públicas firmadas con HMAC-SHA256 para los recursos de los correos.
 *
 * Formato del token: `base64url(JSON) + "." + base64url(HMAC[0..16])`. La carga indica el
 * propósito (miniatura, archivo o logotipo), el tenant y el recurso; el HMAC incluye un prefijo de
 * dominio para que una firma de otro uso (p. ej. tracking en la Fase 3) nunca sea válida aquí.
 * La comparación es en tiempo constante.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PublicAssetLinks } from '@/core/documents/ports';

const DOMAIN = 'mcsn-asset-v1';
const SIGNATURE_BYTES = 16;

const payloadSchema = z.object({
  v: z.literal(1),
  p: z.enum(['thumb', 'file', 'logo']),
  t: z.uuid(),
  r: z.string().min(1).max(200),
});

export type AssetTokenPayload = z.infer<typeof payloadSchema>;

export class HmacPublicAssetLinks implements PublicAssetLinks {
  private readonly baseUrl: string;

  constructor(
    private readonly secret: string,
    baseUrl: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  documentThumbnail(tenantId: string, documentId: string): string {
    return `${this.baseUrl}/trk/i/${this.sign({ v: 1, p: 'thumb', t: tenantId, r: documentId })}`;
  }

  documentDownload(tenantId: string, documentId: string): string {
    return `${this.baseUrl}/trk/d/${this.sign({ v: 1, p: 'file', t: tenantId, r: documentId })}`;
  }

  tenantLogo(tenantId: string, logoKey: string): string {
    return `${this.baseUrl}/trk/i/${this.sign({ v: 1, p: 'logo', t: tenantId, r: logoKey })}`;
  }

  /** Carga verificada, o null si el token está manipulado o mal formado. */
  verify(token: string): AssetTokenPayload | null {
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra !== undefined || token.length > 1024) return null;
    const expected = this.signature(encoded);
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    try {
      const json: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      const parsed = payloadSchema.safeParse(json);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private sign(payload: AssetTokenPayload): string {
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
