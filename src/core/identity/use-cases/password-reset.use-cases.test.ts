import { beforeEach, describe, expect, it } from 'vitest';
import {
  FakeClock,
  FakePasswordHasher,
  FakeTokenService,
  InMemoryUserRepository,
  RecordingAuditLogger,
} from '@tests/fakes/identity.fakes';
import type { SystemMailMessage } from '../system-mail';
import {
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
  type PasswordResetTokenRepository,
} from './password-reset.use-cases';

class InMemoryResetTokens implements PasswordResetTokenRepository {
  readonly tokens = new Map<string, { userId: string; expiresAt: Date }>();
  async replace(userId: string, tokenHash: string, expiresAt: Date) {
    for (const [hash, entry] of this.tokens) if (entry.userId === userId) this.tokens.delete(hash);
    this.tokens.set(tokenHash, { userId, expiresAt });
  }
  async consume(tokenHash: string, now: Date) {
    const entry = this.tokens.get(tokenHash);
    this.tokens.delete(tokenHash);
    return entry && entry.expiresAt > now ? entry.userId : null;
  }
}

let users: InMemoryUserRepository;
let resets: InMemoryResetTokens;
let mails: SystemMailMessage[];
let clock: FakeClock;
const tokens = new FakeTokenService();
const hasher = new FakePasswordHasher();

beforeEach(() => {
  users = new InMemoryUserRepository();
  resets = new InMemoryResetTokens();
  mails = [];
  clock = new FakeClock();
});

const request = () =>
  new RequestPasswordResetUseCase({
    users,
    resets,
    tokens,
    mail: { enqueue: async (message) => void mails.push(message) },
    clock,
  });
const reset = () =>
  new ResetPasswordUseCase({
    users,
    resets,
    tokens,
    hasher,
    audit: new RecordingAuditLogger(),
    clock,
  });

describe('recuperación de contraseña', () => {
  it('solo envía el enlace a cuentas activas con contraseña (sin revelar si existen)', async () => {
    await users.create({ email: 'ana@multicomputos.com', passwordHash: 'hashed:old-password-123' });
    await users.create({ email: 'sso@multicomputos.com' });
    const buildUrl = (token: string) => `https://app.test/es/reset-password/${token}`;
    await request().execute({ email: 'ANA@multicomputos.com', locale: 'es', buildUrl });
    await request().execute({ email: 'sso@multicomputos.com', locale: 'es', buildUrl });
    await request().execute({ email: 'nadie@multicomputos.com', locale: 'es', buildUrl });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ kind: 'password-reset', to: 'ana@multicomputos.com' });
  });

  it('el enlace cambia la contraseña una sola vez y caduca en una hora', async () => {
    const user = await users.create({
      email: 'ana@multicomputos.com',
      passwordHash: 'hashed:old-password-123',
    });
    let link = '';
    await request().execute({
      email: user.email,
      locale: 'es',
      buildUrl: (token) => (link = token),
    });
    await reset().execute({ token: link, password: 'una-frase-larga-y-nueva' });
    expect((await users.findById(user.id))?.passwordHash).toBe('hashed:una-frase-larga-y-nueva');
    await expect(
      reset().execute({ token: link, password: 'otra-frase-larga-123' }),
    ).rejects.toMatchObject({ code: 'EXPIRED' });

    await request().execute({
      email: user.email,
      locale: 'es',
      buildUrl: (token) => (link = token),
    });
    clock.advance(61 * 60 * 1000);
    await expect(
      reset().execute({ token: link, password: 'otra-frase-larga-123' }),
    ).rejects.toMatchObject({ code: 'EXPIRED' });
  });
});
