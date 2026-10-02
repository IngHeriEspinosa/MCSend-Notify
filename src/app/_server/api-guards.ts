/**
 * Utilidades para route handlers: protección CSRF por origen y respuestas de error homogéneas.
 * Las Server Actions ya comprueban el origen; los route handlers con cookies lo hacen aquí.
 */
import 'server-only';
import { getServerEnv } from '@/common/config/env';
import type { DomainError } from '@/core/shared/domain-error';

const STATUS_BY_CODE: Record<DomainError['code'], number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  RATE_LIMITED: 429,
  INVALID_STATE: 409,
  EXPIRED: 410,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
};

export function errorResponse(
  code: DomainError['code'] | 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE',
  details?: unknown,
) {
  const status =
    code === 'BAD_REQUEST' ? 400 : code === 'PAYLOAD_TOO_LARGE' ? 413 : STATUS_BY_CODE[code];
  return Response.json(
    { error: { code, ...(details ? { details } : {}) } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Rechaza peticiones con cookies que no provienen del propio origen de la app (CSRF, OWASP A01). */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const allowed = new Set([new URL(getServerEnv().APP_URL).origin]);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const protocol =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');
  if (host) allowed.add(`${protocol}://${host}`);
  return allowed.has(origin);
}
