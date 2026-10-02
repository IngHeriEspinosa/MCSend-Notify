'use client';

/** Formularios de recuperación de contraseña: solicitud del enlace y elección de la nueva. */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import {
  requestPasswordResetAction,
  resetPasswordAction,
} from '@/app/_server/actions/public.actions';
import { Link } from '@/common/i18n/navigation';

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Card variant="outlined">
      <CardContent className="flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <Typography variant="h5" component="h1">
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function ForgotPasswordForm() {
  const t = useTranslations('PasswordReset');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'sent' | 'rate_limited' | 'error'>('idle');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    startTransition(async () => {
      const result = await requestPasswordResetAction({ email }, locale === 'en' ? 'en' : 'es');
      setState(
        result.ok ? 'sent' : result.error.code === 'RATE_LIMITED' ? 'rate_limited' : 'error',
      );
    });
  };

  return (
    <Shell title={t('forgotTitle')} subtitle={t('forgotSubtitle')}>
      {state === 'sent' ? (
        <Alert severity="success" role="status">
          {t('sent')}
        </Alert>
      ) : null}
      {state === 'rate_limited' ? <Alert severity="warning">{t('rateLimited')}</Alert> : null}
      {state === 'error' ? <Alert severity="error">{t('invalidEmail')}</Alert> : null}
      {state !== 'sent' ? (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <TextField
            name="email"
            type="email"
            label={t('email')}
            autoComplete="username"
            required
            fullWidth
          />
          <Button type="submit" variant="contained" size="large" disabled={pending}>
            {t('sendLink')}
          </Button>
        </form>
      ) : null}
      <Link href="/login" className="self-center text-sm text-primary hover:underline">
        {t('backToLogin')}
      </Link>
    </Shell>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('PasswordReset');
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'done' | 'expired' | 'mismatch' | 'invalid'>('idle');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) {
      setState('mismatch');
      return;
    }
    startTransition(async () => {
      const result = await resetPasswordAction({ token, password });
      setState(result.ok ? 'done' : result.error.code === 'EXPIRED' ? 'expired' : 'invalid');
    });
  };

  return (
    <Shell title={t('resetTitle')} subtitle={t('resetSubtitle')}>
      {state === 'done' ? (
        <Alert severity="success" role="status">
          {t('done')}
        </Alert>
      ) : null}
      {state === 'expired' ? <Alert severity="error">{t('expired')}</Alert> : null}
      {state === 'mismatch' ? <Alert severity="error">{t('mismatch')}</Alert> : null}
      {state === 'invalid' ? <Alert severity="error">{t('weakPassword')}</Alert> : null}
      {state !== 'done' ? (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <TextField
            name="password"
            type="password"
            label={t('newPassword')}
            autoComplete="new-password"
            helperText={t('passwordHint')}
            required
            fullWidth
            slotProps={{ htmlInput: { minLength: 12, maxLength: 128 } }}
          />
          <TextField
            name="confirm"
            type="password"
            label={t('confirmPassword')}
            autoComplete="new-password"
            required
            fullWidth
          />
          <Button type="submit" variant="contained" size="large" disabled={pending}>
            {t('savePassword')}
          </Button>
        </form>
      ) : null}
      <Link href="/login" className="self-center text-sm text-primary hover:underline">
        {t('backToLogin')}
      </Link>
    </Shell>
  );
}
