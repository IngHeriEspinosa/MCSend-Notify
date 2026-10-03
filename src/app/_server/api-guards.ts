/**
 * Utilidades para route handlers: protección CSRF por origen y respuestas de error homogéneas.
 * Las Server Actions ya comprueban el origen; los route handlers con cookies lo hacen aquí.
 */
import 'server-only';
import { getServerEnv } from '@/common/config/env';
import type { DomainError } from '@/core/shared/domain-error';
import type { TenantContext } from '@/core/shared/tenant-context';
import { getRateLimiter } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

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

function readApiKey(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return request.headers.get('x-api-key');
}

/**
 * API pública: autentica la clave (`Authorization: Bearer mcsn_...` o `x-api-key`) y aplica el
 * límite de peticiones por clave. Devuelve el contexto del tenant de la clave.
 */
export async function authenticateApiRequest(request: Request): Promise<TenantContext> {
  const context = await useCases.authenticateApiKey().execute(readApiKey(request) ?? '');
  if (context.actor.type === 'apiKey') {
    await getRateLimiter('publicApi').consume(context.actor.apiKeyId);
  }
  return context;
}
