import { beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  FakeClock,
  FakePasswordHasher,
  FakeTokenService,
  InMemoryInvitationRepository,
  InMemoryMembershipRepository,
  InMemoryUserRepository,
  RecordingAuditLogger,
} from '@tests/fakes/identity.fakes';
import {
  AcceptInvitationUseCase,
  GetInvitationUseCase,
  RegisterFromInvitationUseCase,
} from './accept-invitation.use-case';
import {
  AuthenticateWithCredentialsUseCase,
  LOCK_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
} from './authenticate-with-credentials.use-case';
import { INVITATION_TTL_MS, InviteMemberUseCase } from './invite-member.use-case';
import { ChangeMemberRoleUseCase, RemoveMemberUseCase } from './manage-members.use-case';

const ownerContext = (userId = 'owner-1'): TenantContext => ({
  tenantId: 'tenant-a',
  tenantSlug: 'mcsupport',
  actor: { type: 'user', userId, role: 'OWNER', isPlatformAdmin: false },
});

describe('AuthenticateWithCredentialsUseCase', () => {
  let users: InMemoryUserRepository;
  let clock: FakeClock;
  let useCase: AuthenticateWithCredentialsUseCase;

  beforeEach(async () => {
    users = new InMemoryUserRepository();
    clock = new FakeClock();
    useCase = new AuthenticateWithCredentialsUseCase(users, new FakePasswordHasher(), clock);
    await users.create({ email: 'ana@multicomputos.com', passwordHash: 'hashed:correct-password' });
  });

  it('autentica con email en cualquier capitalización', async () => {
    const user = await useCase.execute({
      email: ' ANA@multicomputos.com ',
      password: 'correct-password',
    });
    expect(user.email).toBe('ana@multicomputos.com');
  });

  it('usa el mismo error para usuario inexistente y contraseña incorrecta', async () => {
    await expect(useCase.execute({ email: 'nadie@x.com', password: 'x' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(
      useCase.execute({ email: 'ana@multicomputos.com', password: 'mal' }),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('bloquea la cuenta tras los intentos máximos y la libera al expirar el bloqueo', async () => {
    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      await expect(
        useCase.execute({ email: 'ana@multicomputos.com', password: 'mal' }),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    }
    await expect(
      useCase.execute({ email: 'ana@multicomputos.com', password: 'mal' }),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
    });
    await expect(
      useCase.execute({ email: 'ana@multicomputos.com', password: 'correct-password' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });

    clock.advance(LOCK_DURATION_MS + 1);
    await expect(
      useCase.execute({ email: 'ana@multicomputos.com', password: 'correct-password' }),
    ).resolves.toMatchObject({ email: 'ana@multicomputos.com' });
  });
});

describe('invitaciones', () => {
  let users: InMemoryUserRepository;
  let memberships: InMemoryMembershipRepository;
  let invitations: InMemoryInvitationRepository;
  let tokens: FakeTokenService;
  let audit: RecordingAuditLogger;
  let clock: FakeClock;
  let invite: InviteMemberUseCase;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    memberships = new InMemoryMembershipRepository();
    invitations = new InMemoryInvitationRepository(memberships);
    tokens = new FakeTokenService();
    audit = new RecordingAuditLogger();
    clock = new FakeClock();
    memberships.add('tenant-a', 'owner-1', 'OWNER');
    invite = new InviteMemberUseCase(invitations, memberships, users, tokens, audit, clock);
  });

  it('guarda solo el hash del token y audita la invitación', async () => {
    const result = await invite.execute(ownerContext(), {
      email: 'Luis@Cliente.com',
      role: 'EDITOR',
    });

    expect(invitations.invitations[0]?.tokenHash).toBe(tokens.hash(result.token));
    expect(invitations.invitations[0]?.email).toBe('luis@cliente.com');
    expect(result.expiresAt.getTime() - clock.now().getTime()).toBe(INVITATION_TTL_MS);
    expect(audit.entries.map((entry) => entry.action)).toEqual(['member.invited']);
  });

  it('un ADMIN no puede invitar a un OWNER', async () => {
    const admin: TenantContext = {
      ...ownerContext('admin-1'),
      actor: { type: 'user', userId: 'admin-1', role: 'ADMIN', isPlatformAdmin: false },
    };
    await expect(invite.execute(admin, { email: 'x@y.com', role: 'OWNER' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rechaza invitar a quien ya es miembro', async () => {
    const existing = await users.create({ email: 'ya@miembro.com' });
    memberships.add('tenant-a', existing.id, 'VIEWER');
    await expect(
      invite.execute(ownerContext(), { email: 'ya@miembro.com', role: 'EDITOR' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('una persona sin cuenta se registra con la invitación y queda como miembro', async () => {
    const { token } = await invite.execute(ownerContext(), {
      email: 'nueva@cliente.com',
      role: 'EDITOR',
    });
    const get = new GetInvitationUseCase(invitations, users, tokens, clock);
    expect(await get.execute(token)).toMatchObject({ hasAccount: false, role: 'EDITOR' });

    const register = new RegisterFromInvitationUseCase(
      invitations,
      users,
      new FakePasswordHasher(),
      tokens,
      audit,
      clock,
    );
    await register.execute({ token, name: 'Nueva', password: 'una-clave-segura-123' });

    const created = await users.findByEmail('nueva@cliente.com');
    expect(created?.passwordHash).toBe('hashed:una-clave-segura-123');
    expect(
      memberships.members.some(
        (member) => member.userId === created?.id && member.role === 'EDITOR',
      ),
    ).toBe(true);
    await expect(get.execute(token)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('un usuario con sesión solo acepta invitaciones de su propio email', async () => {
    const { token } = await invite.execute(ownerContext(), {
      email: 'luis@cliente.com',
      role: 'VIEWER',
    });
    const accept = new AcceptInvitationUseCase(invitations, tokens, audit, clock);

    await expect(
      accept.execute({ token, user: { id: 'otro', email: 'otro@cliente.com' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      accept.execute({ token, user: { id: 'luis', email: 'LUIS@cliente.com' } }),
    ).resolves.toEqual({ tenantSlug: 'mcsupport' });
  });

  it('rechaza invitaciones caducadas', async () => {
    const { token } = await invite.execute(ownerContext(), {
      email: 'tarde@cliente.com',
      role: 'VIEWER',
    });
    clock.advance(INVITATION_TTL_MS + 1);
    await expect(
      new GetInvitationUseCase(invitations, users, tokens, clock).execute(token),
    ).rejects.toMatchObject({
      code: 'EXPIRED',
    });
  });
});

describe('gestión de miembros', () => {
  it('impide degradar o expulsar al último OWNER', async () => {
    const memberships = new InMemoryMembershipRepository();
    const owner = memberships.add('tenant-a', 'owner-1', 'OWNER');
    const audit = new RecordingAuditLogger();

    await expect(
      new ChangeMemberRoleUseCase(memberships, audit).execute(ownerContext(), {
        membershipId: owner.id,
        role: 'ADMIN',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(
      new RemoveMemberUseCase(memberships, audit).execute(ownerContext(), owner.id),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('no permite operar sobre miembros de otro tenant', async () => {
    const memberships = new InMemoryMembershipRepository();
    const foreign = memberships.add('tenant-b', 'u-b', 'EDITOR');
    await expect(
      new RemoveMemberUseCase(memberships, new RecordingAuditLogger()).execute(
        ownerContext(),
        foreign.id,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
