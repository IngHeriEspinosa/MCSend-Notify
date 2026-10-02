/** Entidades y puertos del módulo de identidad. */
import type { TenantContext } from '@/core/shared/tenant-context';
import type { MembershipRole, PlatformRole } from './roles';

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  platformRole: PlatformRole;
  isActive: boolean;
  sessionVersion: number;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface MemberView {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: MembershipRole;
  createdAt: Date;
}

export interface InvitationRecord {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  email: string;
  role: MembershipRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: {
    email: string;
    name?: string | undefined;
    passwordHash?: string;
  }): Promise<UserRecord>;
  recordFailedLogin(
    userId: string,
    failedLoginCount: number,
    lockedUntil: Date | null,
  ): Promise<void>;
  recordSuccessfulLogin(userId: string, at: Date): Promise<void>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
}

export interface MembershipRepository {
  list(context: TenantContext): Promise<MemberView[]>;
  findById(context: TenantContext, membershipId: string): Promise<MemberView | null>;
  findByUserId(context: TenantContext, userId: string): Promise<MemberView | null>;
  countOwners(context: TenantContext): Promise<number>;
  updateRole(context: TenantContext, membershipId: string, role: MembershipRole): Promise<void>;
  delete(context: TenantContext, membershipId: string): Promise<void>;
}

export interface InvitationRepository {
  create(
    context: TenantContext,
    input: {
      email: string;
      role: MembershipRole;
      tokenHash: string;
      expiresAt: Date;
      invitedById: string;
    },
  ): Promise<InvitationRecord>;
  /** Búsqueda global por hash: el token identifica al tenant. */
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  listPending(context: TenantContext, now: Date): Promise<InvitationRecord[]>;
  revoke(context: TenantContext, invitationId: string, at: Date): Promise<boolean>;
  /** Crea la membresía (o actualiza su rol) y marca la invitación como aceptada, de forma atómica. */
  accept(invitation: InvitationRecord, userId: string, at: Date): Promise<void>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}
