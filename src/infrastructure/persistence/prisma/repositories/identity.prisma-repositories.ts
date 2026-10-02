/** Repositorios de identidad: usuarios (globales), membresías e invitaciones (por tenant). */
import type {
  InvitationRecord,
  InvitationRepository,
  MemberView,
  MembershipRepository,
  UserRecord,
  UserRepository,
} from '@/core/identity/ports';
import type { MembershipRole } from '@/core/identity/roles';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { PrismaClient } from '../generated/client';
import type { TenantClientCache } from '../tenant-scope.extension';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  platformRole: true,
  isActive: true,
  sessionVersion: true,
  failedLoginCount: true,
  lockedUntil: true,
} as const;

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { email }, select: USER_SELECT });
  }

  findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  }

  create(input: {
    email: string;
    name?: string | undefined;
    passwordHash?: string;
  }): Promise<UserRecord> {
    return this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name ?? null,
        passwordHash: input.passwordHash ?? null,
      },
      select: USER_SELECT,
    });
  }

  async recordFailedLogin(
    userId: string,
    failedLoginCount: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount, lockedUntil },
    });
  }

  async recordSuccessfulLogin(userId: string, at: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: at },
    });
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    // Cambiar la contraseña invalida las sesiones existentes.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  }
}

const MEMBER_INCLUDE = { user: { select: { email: true, name: true } } } as const;

interface MembershipRow {
  id: string;
  userId: string;
  role: MembershipRole;
  createdAt: Date;
  user: { email: string; name: string | null };
}

function toMemberView(row: MembershipRow): MemberView {
  return {
    id: row.id,
    userId: row.userId,
    email: row.user.email,
    name: row.user.name,
    role: row.role,
    createdAt: row.createdAt,
  };
}

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async list(context: TenantContext): Promise<MemberView[]> {
    const rows = await this.clients.forTenant(context.tenantId).tenantMembership.findMany({
      include: MEMBER_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toMemberView);
  }

  async findById(context: TenantContext, membershipId: string): Promise<MemberView | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .tenantMembership.findFirst({ where: { id: membershipId }, include: MEMBER_INCLUDE });
    return row ? toMemberView(row) : null;
  }

  async findByUserId(context: TenantContext, userId: string): Promise<MemberView | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .tenantMembership.findFirst({ where: { userId }, include: MEMBER_INCLUDE });
    return row ? toMemberView(row) : null;
  }

  countOwners(context: TenantContext): Promise<number> {
    return this.clients
      .forTenant(context.tenantId)
      .tenantMembership.count({ where: { role: 'OWNER' } });
  }

  async updateRole(
    context: TenantContext,
    membershipId: string,
    role: MembershipRole,
  ): Promise<void> {
    await this.clients
      .forTenant(context.tenantId)
      .tenantMembership.updateMany({ where: { id: membershipId }, data: { role } });
  }

  async delete(context: TenantContext, membershipId: string): Promise<void> {
    await this.clients
      .forTenant(context.tenantId)
      .tenantMembership.deleteMany({ where: { id: membershipId } });
  }
}

interface InvitationRow {
  id: string;
  tenantId: string;
  email: string;
  role: MembershipRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  tenant: { slug: string; name: string };
}

const INVITATION_INCLUDE = { tenant: { select: { slug: true, name: true } } } as const;

function toInvitationRecord(row: InvitationRow): InvitationRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantSlug: row.tenant.slug,
    tenantName: row.tenant.name,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export class PrismaInvitationRepository implements InvitationRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  async create(
    context: TenantContext,
    input: {
      email: string;
      role: MembershipRole;
      tokenHash: string;
      expiresAt: Date;
      invitedById: string;
    },
  ): Promise<InvitationRecord> {
    const row = await this.clients.forTenant(context.tenantId).invitation.create({
      data: { ...input, tenantId: context.tenantId },
      include: INVITATION_INCLUDE,
    });
    return toInvitationRecord(row);
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    // Consulta global intencionada: el token (secreto) es lo que identifica al tenant.
    const row = await this.prisma.invitation.findUnique({
      where: { tokenHash },
      include: INVITATION_INCLUDE,
    });
    return row ? toInvitationRecord(row) : null;
  }

  async listPending(context: TenantContext, now: Date): Promise<InvitationRecord[]> {
    const rows = await this.clients.forTenant(context.tenantId).invitation.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      include: INVITATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toInvitationRecord);
  }

  async revoke(context: TenantContext, invitationId: string, at: Date): Promise<boolean> {
    const { count } = await this.clients.forTenant(context.tenantId).invitation.updateMany({
      where: { id: invitationId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: at },
    });
    return count > 0;
  }

  async accept(invitation: InvitationRecord, userId: string, at: Date): Promise<void> {
    const scoped = this.clients.forTenant(invitation.tenantId);
    await scoped.$transaction(async (tx) => {
      // Marca la invitación solo si sigue pendiente: evita aceptaciones dobles concurrentes.
      const { count } = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: at },
      });
      if (count === 0) throw new Error('La invitación ya no está pendiente');
      await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
        create: { tenantId: invitation.tenantId, userId, role: invitation.role },
        update: { role: invitation.role },
      });
    });
  }
}
