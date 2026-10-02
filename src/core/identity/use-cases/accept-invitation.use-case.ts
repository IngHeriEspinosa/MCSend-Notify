/**
 * Aceptación de invitaciones:
 * - `GetInvitationUseCase`: valida el token y devuelve los datos públicos de la invitación.
 * - `AcceptInvitationUseCase`: un usuario con sesión acepta (su email debe coincidir).
 * - `RegisterFromInvitationUseCase`: alta con contraseña de una persona sin cuenta.
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock, SecretTokenService } from '@/core/shared/ports';
import { systemContext } from '@/core/shared/tenant-context';
import { normalizeEmail } from '../email';
import { passwordSchema } from '../password-policy';
import type {
  InvitationRecord,
  InvitationRepository,
  PasswordHasher,
  UserRepository,
} from '../ports';

async function findValidInvitation(
  invitations: InvitationRepository,
  tokens: SecretTokenService,
  token: string,
  now: Date,
): Promise<InvitationRecord> {
  const invitation = await invitations.findByTokenHash(tokens.hash(token));
  if (!invitation || invitation.revokedAt) {
    throw new DomainError('NOT_FOUND', 'Invitación inexistente o revocada');
  }
  if (invitation.acceptedAt) {
    throw new DomainError('INVALID_STATE', 'La invitación ya fue aceptada', {
      reason: 'ALREADY_ACCEPTED',
    });
  }
  if (invitation.expiresAt <= now) {
    throw new DomainError('EXPIRED', 'La invitación ha caducado');
  }
  return invitation;
}

function auditContext(invitation: InvitationRecord) {
  return systemContext(invitation.tenantId, invitation.tenantSlug, 'invitation.accept');
}

export class GetInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly users: UserRepository,
    private readonly tokens: SecretTokenService,
    private readonly clock: Clock,
  ) {}

  async execute(token: string) {
    const invitation = await findValidInvitation(
      this.invitations,
      this.tokens,
      token,
      this.clock.now(),
    );
    const existingUser = await this.users.findByEmail(invitation.email);
    return {
      email: invitation.email,
      role: invitation.role,
      tenantName: invitation.tenantName,
      tenantSlug: invitation.tenantSlug,
      expiresAt: invitation.expiresAt,
      hasAccount: existingUser !== null,
    };
  }
}

export class AcceptInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly tokens: SecretTokenService,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  async execute(input: { token: string; user: { id: string; email: string } }) {
    const now = this.clock.now();
    const invitation = await findValidInvitation(this.invitations, this.tokens, input.token, now);
    if (normalizeEmail(input.user.email) !== invitation.email) {
      throw new DomainError('FORBIDDEN', 'La invitación pertenece a otro email', {
        reason: 'EMAIL_MISMATCH',
      });
    }
    await this.invitations.accept(invitation, input.user.id, now);
    await this.audit.record(auditContext(invitation), {
      action: 'member.joined',
      entityType: 'invitation',
      entityId: invitation.id,
      metadata: { userId: input.user.id, role: invitation.role },
    });
    return { tenantSlug: invitation.tenantSlug };
  }
}

export const registerFromInvitationSchema = z.object({
  token: z.string().min(16).max(256),
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
});

export class RegisterFromInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: SecretTokenService,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  async execute(input: z.infer<typeof registerFromInvitationSchema>) {
    const now = this.clock.now();
    const invitation = await findValidInvitation(this.invitations, this.tokens, input.token, now);
    if (await this.users.findByEmail(invitation.email)) {
      throw new DomainError('CONFLICT', 'Ya existe una cuenta con este email', {
        reason: 'ACCOUNT_EXISTS',
      });
    }
    const user = await this.users.create({
      email: invitation.email,
      name: input.name,
      passwordHash: await this.hasher.hash(input.password),
    });
    await this.invitations.accept(invitation, user.id, now);
    await this.audit.record(auditContext(invitation), {
      action: 'member.registered',
      entityType: 'user',
      entityId: user.id,
      metadata: { role: invitation.role },
    });
    return { email: user.email, tenantSlug: invitation.tenantSlug };
  }
}
