/**
 * Contexto de ejecución de toda operación de negocio dentro de un tenant.
 * El `tenantId` nunca proviene del cliente: lo resuelve la capa de presentación a partir
 * del slug de la URL y de la membresía del usuario, o de la clave de API.
 */
import type { ApiScope } from '@/core/api-keys/api-scopes';
import type { MembershipRole } from '@/core/identity/roles';

export type Actor =
  | { type: 'user'; userId: string; role: MembershipRole; isPlatformAdmin: boolean }
  | { type: 'apiKey'; apiKeyId: string; scopes: readonly ApiScope[] }
  | { type: 'system'; reason: string };

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  actor: Actor;
  requestMeta?: RequestMeta | undefined;
}

/** Contexto para procesos internos (worker), con el motivo para la auditoría. */
export function systemContext(tenantId: string, tenantSlug: string, reason: string): TenantContext {
  return { tenantId, tenantSlug, actor: { type: 'system', reason } };
}

export function actorUserId(context: TenantContext): string | undefined {
  return context.actor.type === 'user' ? context.actor.userId : undefined;
}
