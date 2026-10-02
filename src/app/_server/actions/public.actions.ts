'use server';

/**
 * Server Actions públicas (sin sesión):
 * - Centro de preferencias: la autorización es el token firmado de la entrega.
 * - Recuperación de contraseña: respuesta idéntica exista o no la cuenta, con límite por IP y email.
 * Next.js ya rechaza las Server Actions de otro origen (CSRF).
 */
import { runAction } from '@/app/_server/action-client';
import { getRequestMeta } from '@/app/_server/session';
import { getServerEnv } from '@/common/config/env';
import { updatePreferencesSchema } from '@/core/campaigns/use-cases/tracking.use-cases';
import { DomainError } from '@/core/shared/domain-error';
import {
  requestPasswordResetSchema,
  resetPasswordSchema,
} from '@/core/identity/use-cases/password-reset.use-cases';
import { getRateLimiter, getTrackingLinks } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export async function updatePreferencesAction(token: string, rawInput: unknown) {
  return runAction(
    async () => {
      const payload = getTrackingLinks().verify(token, 'u');
      if (!payload) throw new DomainError('NOT_FOUND', 'Enlace no válido');
      const input = updatePreferencesSchema.parse(rawInput);
      const done = await useCases.tracking().updatePreferences(payload.t, payload.d, input);
      if (!done) throw new DomainError('NOT_FOUND', 'Enlace no válido');
    },
    { refresh: false },
  );
}

export async function requestPasswordResetAction(rawInput: unknown, locale: 'es' | 'en') {
  return runAction(
    async () => {
      const { email } = requestPasswordResetSchema.parse(rawInput);
      const meta = await getRequestMeta();
      await getRateLimiter('passwordReset').consume(
        `${meta.ip ?? 'unknown'}:${email.toLowerCase()}`,
      );
      const baseUrl = getServerEnv().APP_URL;
      await useCases.requestPasswordReset().execute({
        email,
        locale,
        buildUrl: (token) => new URL(`/${locale}/reset-password/${token}`, baseUrl).toString(),
      });
    },
    { refresh: false },
  );
}

export async function resetPasswordAction(rawInput: unknown) {
  return runAction(
    async () => {
      const input = resetPasswordSchema.parse(rawInput);
      const meta = await getRequestMeta();
      await getRateLimiter('passwordReset').consume(`reset:${meta.ip ?? 'unknown'}`);
      await useCases.resetPassword().execute(input);
    },
    { refresh: false },
  );
}
