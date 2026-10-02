'use client';

/** Formulario de inicio de sesión (credenciales y Microsoft). */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState, useTransition, type FormEvent } from 'react';
import { loginWithCredentials, loginWithMicrosoft } from '@/app/_server/auth-actions';

type LoginError = 'invalid' | 'locked' | 'rate_limited' | 'unavailable' | 'sso';

interface LoginFormProps {
  callbackUrl: string;
  credentialsEnabled: boolean;
  entraEnabled: boolean;
  initialError?: LoginError | undefined;
}

export function LoginForm({
  callbackUrl,
  credentialsEnabled,
  entraEnabled,
  initialError,
}: LoginFormProps) {
  const t = useTranslations('Auth');
  const [error, setError] = useState<LoginError | undefined>(initialError);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await loginWithCredentials({
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        callbackUrl,
      });
      setError(result?.error);
    });
  };

  return (
    <Card variant="outlined">
      <CardContent className="flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <Typography variant="h5" component="h1">
            {t('loginTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('loginSubtitle')}
          </Typography>
        </div>

        {error ? <Alert severity="error">{t(`errors.${error}`)}</Alert> : null}

        {entraEnabled ? (
          <Button
            variant="outlined"
            size="large"
            disabled={pending}
            onClick={() => startTransition(() => loginWithMicrosoft(callbackUrl))}
          >
            {t('withMicrosoft')}
          </Button>
        ) : null}

        {entraEnabled && credentialsEnabled ? <Divider>{t('or')}</Divider> : null}

        {credentialsEnabled ? (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <TextField
              name="email"
              type="email"
              label={t('email')}
              autoComplete="username"
              required
              fullWidth
            />
            <TextField
              name="password"
              type="password"
              label={t('password')}
              autoComplete="current-password"
              required
              fullWidth
            />
            <Button type="submit" variant="contained" size="large" disabled={pending}>
              {pending ? t('submitting') : t('submit')}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
