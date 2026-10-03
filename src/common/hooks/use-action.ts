'use client';

/**
 * Ejecuta una Server Action que devuelve ActionResult: gestiona el estado pendiente,
 * traduce los errores de dominio y notifica el resultado.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useState, useTransition } from 'react';
import type { ActionError, ActionResult } from '@/common/utils/action-result';
import { isErrorReason } from '@/common/utils/error-reasons';
import { useNotify } from './notifications';

export function useActionErrorMessage() {
  const t = useTranslations('Errors');
  return useCallback(
    (error: ActionError): string => {
      const reason = error.details?.reason;
      if (error.code === 'INVALID_STATE' && reason === 'LAST_OWNER') return t('lastOwner');
      if (error.code === 'CONFLICT' && reason === 'ALREADY_MEMBER') return t('alreadyMember');
      if (error.code === 'CONFLICT' && reason === 'STALE_VERSION') return t('staleVersion');
      if (error.code === 'VALIDATION' && reason === 'TEMPLATE_RENDER') return t('templateRender');
      if (reason === 'BLOCKING_ISSUES') return t('blockingIssues');
      if (reason === 'CONFIRMATION_REQUIRED') return t('confirmationRequired');
      if (reason === 'SCHEDULE_IN_PAST') return t('scheduleInPast');
      if (reason === 'PROVIDER_ERROR') return t('providerError');
      if (reason === 'PROVIDER_IN_USE') return t('providerInUse');
      if (reason === 'SENDER_MISSING') return t('senderMissing');
      if (error.code === 'UNEXPECTED') return t('UNEXPECTED', { traceId: error.traceId ?? '-' });
      if (isErrorReason(reason)) return t(`reasons.${reason}`);
      return t(error.code);
    },
    [t],
  );
}

interface RunOptions<T> {
  successMessage?: string;
  onSuccess?: (data: T) => void;
}

export function useAction() {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const notify = useNotify();
  const errorMessage = useActionErrorMessage();

  const run = useCallback(
    <T>(action: () => Promise<ActionResult<T>>, options: RunOptions<T> = {}) =>
      new Promise<ActionResult<T>>((resolve) => {
        startTransition(async () => {
          const result = await action();
          if (result.ok) {
            setFieldErrors({});
            if (options.successMessage) notify(options.successMessage, 'success');
            options.onSuccess?.(result.data);
          } else {
            setFieldErrors(result.error.fields ?? {});
            notify(errorMessage(result.error), 'error');
          }
          resolve(result);
        });
      }),
    [errorMessage, notify],
  );

  return { run, pending, fieldErrors, setFieldErrors };
}
