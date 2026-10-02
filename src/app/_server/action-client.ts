/**
 * Envoltorio de Server Actions por tenant:
 * sesión → tenant (slug + membresía) → validación Zod → caso de uso (permisos) → resultado tipado.
 * Los errores de dominio se devuelven como códigos estables que la UI traduce; los inesperados
 * se registran con su traceId y nunca exponen detalles internos (OWASP A04/A09).
 */
import 'server-only';
import { refresh } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { isDomainError } from '@/core/shared/domain-error';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { ActionError, ActionResult } from '@/common/utils/action-result';
import { generateTraceId } from '@/common/utils/trace-id';
import { getLogger } from '@/infrastructure/container';
import { runWithTraceId } from '@/infrastructure/observability/trace-context';
import { TenantScopeViolationError } from '@/infrastructure/persistence/prisma/tenant-scope.extension';
import { requireTenant } from './session';

export function toActionError(error: unknown, traceId: string): ActionError {
  if (isDomainError(error)) {
    return { code: error.code, ...(error.details ? { details: error.details } : {}) };
  }
  if (error instanceof z.ZodError) {
    return { code: 'VALIDATION', fields: z.flattenError(error).fieldErrors };
  }
  if (error instanceof TenantScopeViolationError) {
    getLogger().error({ err: error, traceId }, 'Intento de acceso entre tenants bloqueado');
    return { code: 'FORBIDDEN', traceId };
  }
  getLogger().error({ err: error, traceId }, 'Error inesperado en Server Action');
  return { code: 'UNEXPECTED', traceId };
}

interface TenantActionOptions {
  /** Refresca la ruta actual tras una mutación correcta (por defecto, sí). */
  refresh?: boolean;
}

export function tenantAction<S extends z.ZodType, R>(
  schema: S,
  handler: (input: z.infer<S>, context: TenantContext) => Promise<R>,
  options: TenantActionOptions = {},
) {
  return async (tenantSlug: string, rawInput: unknown): Promise<ActionResult<R>> => {
    const traceId = generateTraceId();
    try {
      const { context } = await requireTenant(tenantSlug);
      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: 'VALIDATION', fields: z.flattenError(parsed.error).fieldErrors },
        };
      }
      const data = await runWithTraceId(traceId, () => handler(parsed.data, context));
      if (options.refresh !== false) refresh();
      return { ok: true, data };
    } catch (error) {
      unstable_rethrow(error);
      return { ok: false, error: toActionError(error, traceId) };
    }
  };
}

/** Variante para acciones fuera de un tenant (plataforma, invitaciones). */
export async function runAction<R>(
  operation: () => Promise<R>,
  options: TenantActionOptions = {},
): Promise<ActionResult<R>> {
  const traceId = generateTraceId();
  try {
    const data = await runWithTraceId(traceId, operation);
    if (options.refresh !== false) refresh();
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: toActionError(error, traceId) };
  }
}

export { safeRedirectPath } from '@/common/utils/safe-redirect';
