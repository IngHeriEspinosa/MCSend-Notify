'use server';

/** Server Actions de autenticación e invitaciones. */
import { AuthError, CredentialsSignin } from 'next-auth';
import { getLocale } from 'next-intl/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { registerFromInvitationSchema } from '@/core/identity/use-cases/accept-invitation.use-case';
import { useCases } from '@/infrastructure/use-case-factory';
import { runAction, safeRedirectPath } from './action-client';
import { ENTRA_PROVIDER_ID, signIn, signOut, type LoginErrorCode } from './auth';
import { requireUser } from './session';

const LOGIN_ERROR_CODES: readonly LoginErrorCode[] = [
  'invalid',
  'locked',
  'rate_limited',
  'unavailable',
];

async function defaultDestination(): Promise<string> {
  return `/${await getLocale()}/select-tenant`;
}

export async function loginWithCredentials(input: {
  email: string;
  password: string;
  callbackUrl?: string;
}): Promise<{ error: LoginErrorCode } | undefined> {
  const redirectTo = safeRedirectPath(input.callbackUrl, await defaultDestination());
  try {
    await signIn('credentials', { email: input.email, password: input.password, redirectTo });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof CredentialsSignin) {
      const code = LOGIN_ERROR_CODES.find((candidate) => candidate === error.code) ?? 'invalid';
      return { error: code };
    }
    if (error instanceof AuthError) return { error: 'unavailable' };
    throw error;
  }
  return undefined;
}

export async function loginWithMicrosoft(callbackUrl?: string): Promise<void> {
  await signIn(ENTRA_PROVIDER_ID, {
    redirectTo: safeRedirectPath(callbackUrl, await defaultDestination()),
  });
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: `/${await getLocale()}/login` });
}

const tokenSchema = z.string().min(16).max(256);

/** Acepta una invitación con la cuenta de la sesión actual. */
export async function acceptInvitationAction(token: string) {
  return runAction(async () => {
    const user = await requireUser();
    return useCases.acceptInvitation().execute({ token: tokenSchema.parse(token), user });
  });
}

/** Crea la cuenta de la persona invitada y acepta la invitación. */
export async function registerFromInvitationAction(input: unknown) {
  return runAction(() =>
    useCases.registerFromInvitation().execute(registerFromInvitationSchema.parse(input)),
  );
}
