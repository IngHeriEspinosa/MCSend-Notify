/** Dobles en memoria del módulo de identidad para tests unitarios de casos de uso. */
import type { AuditEntry, AuditLogger } from '@/core/audit/audit-log';
import type {
  InvitationRecord,
  InvitationRepository,
  MemberView,
  MembershipRepository,
  PasswordHasher,
  UserRecord,
  UserRepository,
} from '@/core/identity/ports';
import type { MembershipRole } from '@/core/identity/roles';
import type { Clock, SecretTokenService } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';

export class FakeClock implements Clock {
  constructor(public current = new Date('2026-10-02T12:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class RecordingAuditLogger implements AuditLogger {
  readonly entries: Array<AuditEntry & { tenantId: string | null }> = [];
  async record(context: TenantContext | null, entry: AuditEntry): Promise<void> {
    this.entries.push({ ...entry, tenantId: context?.tenantId ?? null });
  }
}

/** "Hash" reversible solo para tests: evita el coste de argon2. */
export class FakePasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return `hashed:${password}`;
  }
  async verify(passwordHash: string, password: string): Promise<boolean> {
    return passwordHash === `hashed:${password}`;
  }
}

export class FakeTokenService implements SecretTokenService {
  private counter = 0;
  generate() {
    this.counter += 1;
    const token = `token-${this.counter}-abcdefghijklmnop`;
    return { token, hash: this.hash(token) };
  }
  hash(token: string): string {
    return `h(${token})`;
  }
}

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, UserRecord>();
  private sequence = 0;

  async findByEmail(email: string) {
    return [...this.users.values()].find((user) => user.email === email) ?? null;
  }
  async findById(id: string) {
    return this.users.get(id) ?? null;
  }
  async create(input: { email: string; name?: string | undefined; passwordHash?: string }) {
    this.sequence += 1;
    const user: UserRecord = {
      id: `user-${this.sequence}`,
      email: input.email,
      name: input.name ?? null,
      passwordHash: input.passwordHash ?? null,
      platformRole: 'USER',
      isActive: true,
      sessionVersion: 0,
      failedLoginCount: 0,
      lockedUntil: null,
    };
    this.users.set(user.id, user);
    return user;
  }
  async recordFailedLogin(userId: string, failedLoginCount: number, lockedUntil: Date | null) {
    const user = this.users.get(userId);
    if (user) this.users.set(userId, { ...user, failedLoginCount, lockedUntil });
  }
  async recordSuccessfulLogin(userId: string) {
    const user = this.users.get(userId);
    if (user) this.users.set(userId, { ...user, failedLoginCount: 0, lockedUntil: null });
  }
  async setPassword(userId: string, passwordHash: string) {
    const user = this.users.get(userId);
    if (user) this.users.set(userId, { ...user, passwordHash });
  }
}

export class InMemoryMembershipRepository implements MembershipRepository {
  readonly members: Array<MemberView & { tenantId: string }> = [];

  add(tenantId: string, userId: string, role: MembershipRole, email = `${userId}@example.com`) {
    const member = {
      id: `m-${this.members.length + 1}`,
      tenantId,
      userId,
      role,
      email,
      name: null,
      createdAt: new Date(),
    };
    this.members.push(member);
    return member;
  }
  async list(context: TenantContext) {
    return this.members.filter((member) => member.tenantId === context.tenantId);
  }
  async findById(context: TenantContext, id: string) {
    return (
      this.members.find((member) => member.id === id && member.tenantId === context.tenantId) ??
      null
    );
  }
  async findByUserId(context: TenantContext, userId: string) {
    return (
      this.members.find(
        (member) => member.userId === userId && member.tenantId === context.tenantId,
      ) ?? null
    );
  }
  async countOwners(context: TenantContext) {
    return this.members.filter(
      (member) => member.tenantId === context.tenantId && member.role === 'OWNER',
    ).length;
  }
  async updateRole(_context: TenantContext, id: string, role: MembershipRole) {
    const member = this.members.find((candidate) => candidate.id === id);
    if (member) member.role = role;
  }
  async delete(_context: TenantContext, id: string) {
    const index = this.members.findIndex((candidate) => candidate.id === id);
    if (index >= 0) this.members.splice(index, 1);
  }
}

export class InMemoryInvitationRepository implements InvitationRepository {
  readonly invitations: Array<InvitationRecord & { tokenHash: string }> = [];

  constructor(private readonly memberships: InMemoryMembershipRepository) {}

  async create(
    context: TenantContext,
    input: {
      email: string;
      role: MembershipRole;
      tokenHash: string;
      expiresAt: Date;
      invitedById: string;
    },
  ) {
    const invitation = {
      id: `inv-${this.invitations.length + 1}`,
      tenantId: context.tenantId,
      tenantSlug: context.tenantSlug,
      tenantName: 'Tenant',
      email: input.email,
      role: input.role,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.invitations.push(invitation);
    return invitation;
  }
  async findByTokenHash(tokenHash: string) {
    return this.invitations.find((invitation) => invitation.tokenHash === tokenHash) ?? null;
  }
  async listPending(context: TenantContext, now: Date) {
    return this.invitations.filter(
      (invitation) =>
        invitation.tenantId === context.tenantId &&
        !invitation.acceptedAt &&
        !invitation.revokedAt &&
        invitation.expiresAt > now,
    );
  }
  async revoke(context: TenantContext, id: string, at: Date) {
    const invitation = this.invitations.find(
      (candidate) => candidate.id === id && candidate.tenantId === context.tenantId,
    );
    if (!invitation || invitation.revokedAt) return false;
    invitation.revokedAt = at;
    return true;
  }
  async accept(invitation: InvitationRecord, userId: string, at: Date) {
    const stored = this.invitations.find((candidate) => candidate.id === invitation.id);
    if (stored) stored.acceptedAt = at;
    this.memberships.add(invitation.tenantId, userId, invitation.role, invitation.email);
  }
}
