/**
 * Autenticación con Auth.js v5 (OWASP A07).
 * - Credenciales: argon2id, bloqueo por intentos (dominio) y límite por IP + email (Redis).
 * - Microsoft Entra ID (opcional): solo dominios de AUTH_ALLOWED_EMAIL_DOMAINS pueden entrar
 *   o vincularse por email con una cuenta existente.
 * - Sesión JWT de 8 horas. En cada petición se comprueba `sessionVersion` y que el usuario siga
 *   activo, para poder revocar sesiones (caché de 60 s en memoria del proceso).
 */
import 'server-only';
import { PrismaAdapter } from '@auth/prisma-adapter';
import NextAuth, { CredentialsSignin, type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import { z } from 'zod';
import { getAuthEnv } from '@/common/config/env';
import { emailDomain, normalizeEmail } from '@/core/identity/email';
import type { PlatformRole } from '@/core/identity/roles';
import { isDomainError } from '@/core/shared/domain-error';
import { getLogger, getPrisma, getRateLimiter } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const ENTRA_PROVIDER_ID = 'microsoft-entra-id';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const SESSION_CHECK_INTERVAL_MS = 60_000;

/** Códigos de error del login (se muestran traducidos; no revelan si la cuenta existe). */
export type LoginErrorCode = 'invalid' | 'locked' | 'rate_limited' | 'unavailable';

class LoginError extends CredentialsSignin {
  constructor(code: LoginErrorCode) {
    super();
    this.code = code;
  }
}

const credentialsSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

async function authorizeCredentials(raw: unknown, request: Request) {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) throw new LoginError('invalid');
  const email = normalizeEmail(parsed.data.email);
  try {
    await getRateLimiter('login').consume(`${clientIp(request)}:${email}`);
    const user = await useCases.authenticate().execute({ email, password: parsed.data.password });
    return { id: user.id, email: user.email, name: user.name };
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === 'ACCOUNT_LOCKED') throw new LoginError('locked');
      if (error.code === 'RATE_LIMITED') throw new LoginError('rate_limited');
      throw new LoginError('invalid');
    }
    getLogger().error({ err: error }, 'Error inesperado al iniciar sesión');
    throw new LoginError('unavailable');
  }
}

/** Claims propios del JWT, leídos con guardas de tipo (el token es un objeto genérico). */
interface SessionClaims {
  uid: string;
  sv: number;
  pr: PlatformRole;
}

function readClaims(token: Record<string, unknown>): SessionClaims | null {
  const { uid, sv, pr } = token;
  if (typeof uid !== 'string' || typeof sv !== 'number') return null;
  return { uid, sv, pr: pr === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER' };
}

/** Caché por proceso de la última verificación de cada sesión. */
const sessionChecks = new Map<
  string,
  { checkedAt: number; valid: boolean; platformRole: PlatformRole }
>();

async function verifySession(userId: string, sessionVersion: number) {
  const cached = sessionChecks.get(userId);
  if (cached && Date.now() - cached.checkedAt < SESSION_CHECK_INTERVAL_MS) return cached;
  const user = await useCases.getActiveUser().execute(userId);
  const result = {
    checkedAt: Date.now(),
    valid: user !== null && user.sessionVersion === sessionVersion,
    platformRole: user?.platformRole ?? 'USER',
  };
  sessionChecks.set(userId, result);
  return result;
}

function buildConfig(): NextAuthConfig {
  const env = getAuthEnv();
  const entraEnabled = Boolean(
    env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
  );

  return {
    secret: env.AUTH_SECRET,
    trustHost: true,
    adapter: PrismaAdapter(getPrisma()),
    session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
    pages: { signIn: '/login', error: '/login' },
    providers: [
      ...(env.AUTH_CREDENTIALS_ENABLED
        ? [
            Credentials({
              credentials: { email: {}, password: {} },
              authorize: authorizeCredentials,
            }),
          ]
        : []),
      ...(entraEnabled
        ? [
            MicrosoftEntraID({
              clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
              clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
              issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
              // El tenant de Entra verifica el email; la vinculación se limita a dominios permitidos.
              allowDangerousEmailAccountLinking: true,
            }),
          ]
        : []),
    ],
    callbacks: {
      async signIn({ user, account }) {
        if (account?.provider !== ENTRA_PROVIDER_ID) return true;
        const domain = user.email ? emailDomain(user.email) : '';
        const allowed = env.AUTH_ALLOWED_EMAIL_DOMAINS.includes(domain);
        if (!allowed) getLogger().warn({ domain }, 'Inicio de sesión SSO rechazado por dominio');
        return allowed;
      },
      async jwt({ token, user }) {
        if (user?.id) {
          const active = await useCases.getActiveUser().execute(user.id);
          if (!active) return null;
          return { ...token, uid: active.id, sv: active.sessionVersion, pr: active.platformRole };
        }
        const claims = readClaims(token);
        if (!claims) return null;
        const check = await verifySession(claims.uid, claims.sv);
        if (!check.valid) return null;
        return { ...token, pr: check.platformRole };
      },
      session({ session, token }) {
        const claims = readClaims(token);
        if (claims) {
          session.user.id = claims.uid;
          session.user.platformRole = claims.pr;
        }
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => buildConfig());

export function isEntraEnabled(): boolean {
  const env = getAuthEnv();
  return Boolean(env.AUTH_MICROSOFT_ENTRA_ID_ID);
}

export function isCredentialsEnabled(): boolean {
  return getAuthEnv().AUTH_CREDENTIALS_ENABLED;
}
