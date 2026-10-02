import { describe, expect, it } from 'vitest';
import { DomainError } from '@/core/shared/domain-error';
import type { Actor, TenantContext } from '@/core/shared/tenant-context';
import {
  assertCanAssignRole,
  assertCanManageMember,
  assertKeepsAnOwner,
} from './membership-policy';
import { assertCan, can } from './permissions';

const user = (role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER'): Actor => ({
  type: 'user',
  userId: 'u1',
  role,
  isPlatformAdmin: false,
});

describe('permisos por rol', () => {
  it('un VIEWER solo lee', () => {
    expect(can(user('VIEWER'), 'contact:read')).toBe(true);
    expect(can(user('VIEWER'), 'contact:write')).toBe(false);
    expect(can(user('VIEWER'), 'member:manage')).toBe(false);
  });

  it('un EDITOR gestiona contenido pero no miembros, claves ni campos', () => {
    expect(can(user('EDITOR'), 'contact:import')).toBe(true);
    expect(can(user('EDITOR'), 'segment:write')).toBe(true);
    expect(can(user('EDITOR'), 'member:manage')).toBe(false);
    expect(can(user('EDITOR'), 'apikey:manage')).toBe(false);
    expect(can(user('EDITOR'), 'field:manage')).toBe(false);
  });

  it('una clave de API solo obtiene los permisos de sus scopes', () => {
    const apiKey: Actor = { type: 'apiKey', apiKeyId: 'k1', scopes: ['contacts:read'] };
    expect(can(apiKey, 'contact:read')).toBe(true);
    expect(can(apiKey, 'contact:write')).toBe(false);
  });

  it('plantillas y documentos: el EDITOR los gestiona y el VIEWER solo los consulta', () => {
    expect(can(user('EDITOR'), 'template:write')).toBe(true);
    expect(can(user('EDITOR'), 'document:write')).toBe(true);
    expect(can(user('VIEWER'), 'template:read')).toBe(true);
    expect(can(user('VIEWER'), 'document:read')).toBe(true);
    expect(can(user('VIEWER'), 'template:write')).toBe(false);
    expect(can(user('VIEWER'), 'document:write')).toBe(false);
    expect(
      can({ type: 'apiKey', apiKeyId: 'k', scopes: ['contacts:write'] }, 'template:read'),
    ).toBe(false);
  });

  it('assertCan lanza FORBIDDEN', () => {
    const context: TenantContext = { tenantId: 't', tenantSlug: 's', actor: user('VIEWER') };
    expect(() => assertCan(context, 'contact:delete')).toThrow(DomainError);
  });
});

describe('política de miembros', () => {
  it('solo un OWNER asigna OWNER', () => {
    expect(() => assertCanAssignRole('ADMIN', 'OWNER')).toThrow(DomainError);
    expect(() => assertCanAssignRole('OWNER', 'OWNER')).not.toThrow();
  });

  it('nadie asigna un rol superior al propio', () => {
    expect(() => assertCanAssignRole('EDITOR', 'ADMIN')).toThrow(DomainError);
    expect(() => assertCanAssignRole('ADMIN', 'EDITOR')).not.toThrow();
  });

  it('un ADMIN no gestiona a un OWNER', () => {
    expect(() => assertCanManageMember('ADMIN', 'OWNER')).toThrow(DomainError);
    expect(() => assertCanManageMember('ADMIN', 'EDITOR')).not.toThrow();
  });

  it('el tenant conserva siempre un OWNER', () => {
    expect(() => assertKeepsAnOwner('OWNER', 'ADMIN', 1)).toThrow(/OWNER/);
    expect(() => assertKeepsAnOwner('OWNER', null, 1)).toThrow(/OWNER/);
    expect(() => assertKeepsAnOwner('OWNER', 'ADMIN', 2)).not.toThrow();
    expect(() => assertKeepsAnOwner('EDITOR', null, 1)).not.toThrow();
  });
});
