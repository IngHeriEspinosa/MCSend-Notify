/** Datos vigentes del usuario de la sesión: permite revocar sesiones (sessionVersion) y desactivar cuentas. */
import type { UserRepository } from '../ports';
import type { PlatformRole } from '../roles';

export interface ActiveUser {
  id: string;
  email: string;
  name: string | null;
  platformRole: PlatformRole;
  sessionVersion: number;
}

export class GetActiveUserUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(userId: string): Promise<ActiveUser | null> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      platformRole: user.platformRole,
      sessionVersion: user.sessionVersion,
    };
  }
}
