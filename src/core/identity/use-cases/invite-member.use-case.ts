/**
 * Invita a una persona a un tenant. Devuelve el token en claro una sola vez para construir
 * el enlace; en base de datos solo se guarda su hash.
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock, SecretTokenService } from '@/core/shared/ports';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import { normalizeEmail } from '../email';
import { assertCanAssignRole } from '../membership-policy';
import { assertCan } from '../permissions';
import type { InvitationRepository, MembershipRepository, UserRepository } from '../ports';
import { MEMBERSHIP_ROLES } from '../roles';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const inviteMemberSchema = z.object({
  email: z.email().max(254),
  role: z.enum(MEMBERSHIP_ROLES),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export interface InviteMemberResult {
  invitationId: string;
  token: string;
  expiresAt: Date;
}

export class InviteMemberUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly memberships: MembershipRepository,
    private readonly users: UserRepository,
    private readonly tokens: SecretTokenService,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  async execute(context: TenantContext, input: InviteMemberInput): Promise<InviteMemberResult> {
    assertCan(context, 'member:manage');
    const inviterId = actorUserId(context);
    if (context.actor.type !== 'user' || !inviterId) {
      throw new DomainError('FORBIDDEN', 'Solo un usuario puede invitar miembros');
    }
    assertCanAssignRole(context.actor.role, input.role);

    const email = normalizeEmail(input.email);
    const existingUser = await this.users.findByEmail(email);
    if (existingUser && (await this.memberships.findByUserId(context, existingUser.id))) {
      throw new DomainError('CONFLICT', 'La persona ya es miembro del tenant', {
        reason: 'ALREADY_MEMBER',
      });
    }

    const { token, hash } = this.tokens.generate();
    const expiresAt = new Date(this.clock.now().getTime() + INVITATION_TTL_MS);
    const invitation = await this.invitations.create(context, {
      email,
      role: input.role,
      tokenHash: hash,
      expiresAt,
      invitedById: inviterId,
    });

    await this.audit.record(context, {
      action: 'member.invited',
      entityType: 'invitation',
      entityId: invitation.id,
      metadata: { email, role: input.role },
    });
    return { invitationId: invitation.id, token, expiresAt };
  }
}
