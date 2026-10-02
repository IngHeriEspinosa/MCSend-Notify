/**
 * Reglas de gestión de miembros:
 * - Nadie asigna un rol superior al propio; solo un OWNER asigna OWNER.
 * - Un ADMIN no modifica ni expulsa a un OWNER.
 * - El tenant nunca se queda sin al menos un OWNER.
 */
import { DomainError } from '@/core/shared/domain-error';
import { roleRank, type MembershipRole } from './roles';

export function assertCanAssignRole(actorRole: MembershipRole, targetRole: MembershipRole): void {
  const allowed =
    targetRole === 'OWNER' ? actorRole === 'OWNER' : roleRank(actorRole) >= roleRank(targetRole);
  if (!allowed) {
    throw new DomainError('FORBIDDEN', `Un ${actorRole} no puede asignar el rol ${targetRole}`, {
      targetRole,
    });
  }
}

export function assertCanManageMember(actorRole: MembershipRole, memberRole: MembershipRole): void {
  if (memberRole === 'OWNER' && actorRole !== 'OWNER') {
    throw new DomainError('FORBIDDEN', 'Solo un OWNER puede gestionar a otro OWNER');
  }
}

export function assertKeepsAnOwner(
  currentRole: MembershipRole,
  nextRole: MembershipRole | null,
  ownerCount: number,
): void {
  const removesAnOwner = currentRole === 'OWNER' && nextRole !== 'OWNER';
  if (removesAnOwner && ownerCount <= 1) {
    throw new DomainError('INVALID_STATE', 'El tenant debe conservar al menos un OWNER', {
      reason: 'LAST_OWNER',
    });
  }
}
