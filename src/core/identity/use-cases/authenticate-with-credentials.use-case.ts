/**
 * Inicio de sesión con email y contraseña (OWASP A07):
 * - Mensaje genérico ante usuario inexistente o contraseña incorrecta (no revela cuentas).
 * - Verificación con un hash ficticio cuando el usuario no existe (tiempo de respuesta uniforme).
 * - Bloqueo temporal tras MAX_FAILED_ATTEMPTS intentos fallidos consecutivos.
 */
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import { normalizeEmail } from '../email';
import type { PasswordHasher, UserRecord, UserRepository } from '../ports';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  platformRole: UserRecord['platformRole'];
  sessionVersion: number;
}

export class AuthenticateWithCredentialsUseCase {
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
  ) {}

  async execute(input: { email: string; password: string }): Promise<AuthenticatedUser> {
    const now = this.clock.now();
    const user = await this.users.findByEmail(normalizeEmail(input.email));

    if (!user || !user.passwordHash || !user.isActive) {
      await this.verifyAgainstDummy(input.password);
      throw new DomainError('INVALID_CREDENTIALS', 'Credenciales inválidas');
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      throw new DomainError('ACCOUNT_LOCKED', 'Cuenta bloqueada temporalmente', {
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }

    const valid = await this.hasher.verify(user.passwordHash, input.password);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      const lockedUntil =
        failed >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_DURATION_MS) : null;
      await this.users.recordFailedLogin(user.id, lockedUntil ? 0 : failed, lockedUntil);
      throw new DomainError(
        lockedUntil ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
        'Credenciales inválidas',
      );
    }

    await this.users.recordSuccessfulLogin(user.id, now);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      sessionVersion: user.sessionVersion,
    };
  }

  private async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hasher.hash('timing-equalization-placeholder');
    await this.hasher.verify(await this.dummyHash, password);
  }
}
