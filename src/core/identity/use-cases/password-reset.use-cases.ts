/**
 * Recuperación de contraseña:
 * - La solicitud siempre responde igual (no revela si el email existe) y solo genera enlace para
 *   cuentas activas con contraseña (las cuentas solo SSO no obtienen una contraseña por esta vía).
 * - El token es de un solo uso, caduca en 1 hora y solo se guarda su hash.
 * - Al cambiar la contraseña se invalidan todas las sesiones (sessionVersion).
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock, SecretTokenService } from '@/core/shared/ports';
import { normalizeEmail } from '../email';
import { passwordSchema } from '../password-policy';
import type { PasswordHasher, UserRepository } from '../ports';
import type { SystemMailQueue } from '../system-mail';

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface PasswordResetTokenRepository {
  /** Sustituye cualquier token anterior del usuario. */
  replace(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** Consume el token si existe y no ha caducado; devuelve el usuario o null. */
  consume(tokenHash: string, now: Date): Promise<string | null>;
}

export const requestPasswordResetSchema = z.object({ email: z.email().max(254) });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  password: passwordSchema,
});

export class RequestPasswordResetUseCase {
  constructor(
    private readonly deps: {
      users: UserRepository;
      resets: PasswordResetTokenRepository;
      tokens: SecretTokenService;
      mail: SystemMailQueue;
      clock: Clock;
    },
  ) {}

  async execute(input: {
    email: string;
    locale: 'es' | 'en';
    buildUrl: (token: string) => string;
  }): Promise<void> {
    const user = await this.deps.users.findByEmail(normalizeEmail(input.email));
    if (!user?.isActive || !user.passwordHash) return;
    const { token, hash } = this.deps.tokens.generate();
    const expiresAt = new Date(this.deps.clock.now().getTime() + PASSWORD_RESET_TTL_MS);
    await this.deps.resets.replace(user.id, hash, expiresAt);
    await this.deps.mail.enqueue({
      kind: 'password-reset',
      to: user.email,
      locale: input.locale,
      url: input.buildUrl(token),
      expiresAt,
    });
  }
}

export class ResetPasswordUseCase {
  constructor(
    private readonly deps: {
      users: UserRepository;
      resets: PasswordResetTokenRepository;
      tokens: SecretTokenService;
      hasher: PasswordHasher;
      audit: AuditLogger;
      clock: Clock;
    },
  ) {}

  async execute(input: z.infer<typeof resetPasswordSchema>): Promise<void> {
    const userId = await this.deps.resets.consume(
      this.deps.tokens.hash(input.token),
      this.deps.clock.now(),
    );
    if (!userId) throw new DomainError('EXPIRED', 'Enlace de recuperación inválido o caducado');
    await this.deps.users.setPassword(userId, await this.deps.hasher.hash(input.password));
    await this.deps.audit.record(null, {
      action: 'user.password_reset',
      entityType: 'user',
      entityId: userId,
    });
  }
}
