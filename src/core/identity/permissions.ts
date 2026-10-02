/**
 * Autorización por permisos (RBAC). Cada caso de uso exige un permiso con `assertCan`;
 * la UI usa `can` solo para ocultar acciones, nunca como única barrera.
 */
import type { ApiScope } from '@/core/api-keys/api-scopes';
import { DomainError } from '@/core/shared/domain-error';
import type { Actor, TenantContext } from '@/core/shared/tenant-context';
import type { MembershipRole } from './roles';

export const PERMISSIONS = [
  'tenant:read',
  'tenant:update',
  'member:read',
  'member:manage',
  'contact:read',
  'contact:write',
  'contact:delete',
  'contact:import',
  'list:write',
  'segment:write',
  'field:manage',
  'topic:manage',
  'template:read',
  'template:write',
  'document:read',
  'document:write',
  'campaign:read',
  'campaign:write',
  'campaign:send',
  'provider:manage',
  'sender:manage',
  'apikey:manage',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EDITOR_PERMISSIONS: readonly Permission[] = [
  'tenant:read',
  'member:read',
  'contact:read',
  'contact:write',
  'contact:import',
  'list:write',
  'segment:write',
  'template:read',
  'template:write',
  'document:read',
  'document:write',
  'campaign:read',
  'campaign:write',
  'campaign:send',
];

const VIEWER_PERMISSIONS: readonly Permission[] = [
  'tenant:read',
  'member:read',
  'contact:read',
  'template:read',
  'document:read',
  'campaign:read',
];

export const ROLE_PERMISSIONS: Record<MembershipRole, ReadonlySet<Permission>> = {
  OWNER: new Set(PERMISSIONS),
  ADMIN: new Set(PERMISSIONS),
  EDITOR: new Set(EDITOR_PERMISSIONS),
  VIEWER: new Set(VIEWER_PERMISSIONS),
};

const SCOPE_PERMISSIONS: Record<ApiScope, readonly Permission[]> = {
  'contacts:read': ['contact:read'],
  'contacts:write': ['contact:read', 'contact:write', 'list:write'],
};

export function can(actor: Actor, permission: Permission): boolean {
  switch (actor.type) {
    case 'system':
      return true;
    case 'user':
      return ROLE_PERMISSIONS[actor.role].has(permission);
    case 'apiKey':
      return actor.scopes.some((scope) => SCOPE_PERMISSIONS[scope].includes(permission));
  }
}

export function assertCan(context: TenantContext, permission: Permission): void {
  if (!can(context.actor, permission)) {
    throw new DomainError('FORBIDDEN', `El actor no tiene el permiso ${permission}`, {
      permission,
    });
  }
}
