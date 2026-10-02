/** Tipado de la sesión y del JWT de Auth.js con los datos propios de la plataforma. */
import type { DefaultSession } from 'next-auth';
import type { PlatformRole } from '@/core/identity/roles';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      platformRole: PlatformRole;
    } & DefaultSession['user'];
  }
}
