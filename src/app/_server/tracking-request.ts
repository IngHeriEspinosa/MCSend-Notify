/** Datos de la petición para el seguimiento: agente de usuario e IP anonimizada (HMAC con sal diaria). */
import 'server-only';
import { getSigningEnv } from '@/common/config/env';
import { hashIp } from '@/infrastructure/security/tracking-links';

export function trackingMeta(request: Request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    undefined;
  const day = new Date().toISOString().slice(0, 10);
  return {
    userAgent: request.headers.get('user-agent') ?? undefined,
    ipHash: hashIp(getSigningEnv().TRACKING_SIGNING_SECRET, ip, day),
    method: request.method,
  };
}
