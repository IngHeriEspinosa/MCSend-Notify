/** Consulta y gestión de miembros e invitaciones pendientes de un tenant. */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  assertCanAssignRole,
  assertCanManageMember,
  assertKeepsAnOwner,
} from '../membership-policy';
import { assertCan } from '../permissions';
import type {
  InvitationRecord,
  InvitationRepository,
  MemberView,
  MembershipRepository,
} from '../ports';
import { MEMBERSHIP_ROLES, type MembershipRole } from '../roles';

function requireUserRole(context: TenantContext): MembershipRole {
  if (context.actor.type !== 'user') {
    throw new DomainError('FORBIDDEN', 'Solo un usuario puede gestionar miembros');
  }
  return context.actor.role;
}

export class ListMembersUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly invitations: InvitationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    context: TenantContext,
  ): Promise<{ members: MemberView[]; pendingInvitations: InvitationRecord[] }> {
    assertCan(context, 'member:read');
    const [members, pendingInvitations] = await Promise.all([
      this.memberships.list(context),
      this.invitations.listPending(context, this.clock.now()),
    ]);
    return { members, pendingInvitations };
  }
}

export const changeMemberRoleSchema = z.object({
  membershipId: z.uuid(),
  role: z.enum(MEMBERSHIP_ROLES),
});

export class ChangeMemberRoleUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(context: TenantContext, input: z.infer<typeof changeMemberRoleSchema>) {
    assertCan(context, 'member:manage');
    const actorRole = requireUserRole(context);
    const member = await this.memberships.findById(context, input.membershipId);
    if (!member) throw new DomainError('NOT_FOUND', 'Miembro inexistente');

    assertCanManageMember(actorRole, member.role);
    assertCanAssignRole(actorRole, input.role);
    assertKeepsAnOwner(member.role, input.role, await this.memberships.countOwners(context));

    await this.memberships.updateRole(context, member.id, input.role);
    await this.audit.record(context, {
      action: 'member.role_changed',
      entityType: 'membership',
      entityId: member.id,
      metadata: { userId: member.userId, from: member.role, to: input.role },
    });
  }
}

export class RemoveMemberUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(context: TenantContext, membershipId: string) {
    assertCan(context, 'member:manage');
    const actorRole = requireUserRole(context);
    const member = await this.memberships.findById(context, membershipId);
    if (!member) throw new DomainError('NOT_FOUND', 'Miembro inexistente');

    assertCanManageMember(actorRole, member.role);
    assertKeepsAnOwner(member.role, null, await this.memberships.countOwners(context));

    await this.memberships.delete(context, member.id);
    await this.audit.record(context, {
      action: 'member.removed',
      entityType: 'membership',
      entityId: member.id,
      metadata: { userId: member.userId, role: member.role },
    });
  }
}

export class RevokeInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  async execute(context: TenantContext, invitationId: string) {
    assertCan(context, 'member:manage');
    const revoked = await this.invitations.revoke(context, invitationId, this.clock.now());
    if (!revoked) throw new DomainError('NOT_FOUND', 'Invitación inexistente');
    await this.audit.record(context, {
      action: 'member.invitation_revoked',
      entityType: 'invitation',
      entityId: invitationId,
    });
  }
}
