'use client';

/** Acepta una invitación: crea la cuenta, pide iniciar sesión o acepta con la sesión actual. */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  acceptInvitationAction,
  logout,
  registerFromInvitationAction,
} from '@/app/_server/auth-actions';
import { useAction } from '@/common/hooks/use-action';
import { Link, useRouter } from '@/common/i18n/navigation';
import type { MembershipRole } from '@/core/identity/roles';

interface InviteAcceptanceProps {
  token: string;
  invitation: { email: string; role: MembershipRole; tenantName: string; hasAccount: boolean };
  sessionEmail: string | null;
}

export function InviteAcceptance({ token, invitation, sessionEmail }: InviteAcceptanceProps) {
  const t = useTranslations('Auth');
  const tRoles = useTranslations('Roles');
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const [registered, setRegistered] = useState(false);
  const sessionMatches = sessionEmail?.toLowerCase() === invitation.email;
  const callbackUrl = `/invite/${token}`;

  const register = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        registerFromInvitationAction({
          token,
          name: String(form.get('name') ?? ''),
          password: String(form.get('password') ?? ''),
        }),
      { onSuccess: () => setRegistered(true) },
    );
  };

  const accept = () =>
    void run(() => acceptInvitationAction(token), {
      onSuccess: (data) => router.push(`/t/${data.tenantSlug}/dashboard`),
    });

  let body;
  if (registered) {
    body = (
      <>
        <Alert severity="success">{t('invite.registered')}</Alert>
        <Button
          component={Link}
          href={`/login?callbackUrl=${encodeURIComponent('/select-tenant')}`}
          variant="contained"
        >
          {t('submit')}
        </Button>
      </>
    );
  } else if (sessionEmail && !sessionMatches) {
    body = (
      <>
        <Alert severity="warning">{t('invite.wrongAccount', { email: invitation.email })}</Alert>
        <Button variant="outlined" onClick={() => void logout()}>
          {t('signOut')}
        </Button>
      </>
    );
  } else if (sessionMatches) {
    body = (
      <Button variant="contained" size="large" disabled={pending} onClick={accept}>
        {t('invite.accept')}
      </Button>
    );
  } else if (invitation.hasAccount) {
    body = (
      <>
        <Alert severity="info">{t('invite.signInToAccept', { email: invitation.email })}</Alert>
        <Button
          component={Link}
          href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          variant="contained"
        >
          {t('submit')}
        </Button>
      </>
    );
  } else {
    body = (
      <form onSubmit={register} className="flex flex-col gap-4" noValidate>
        <Typography variant="subtitle1" component="h2">
          {t('invite.createAccount')}
        </Typography>
        <TextField label={t('email')} value={invitation.email} disabled fullWidth />
        <TextField
          name="name"
          label={t('invite.name')}
          autoComplete="name"
          required
          fullWidth
          error={Boolean(fieldErrors.name)}
        />
        <TextField
          name="password"
          type="password"
          label={t('password')}
          autoComplete="new-password"
          required
          fullWidth
          error={Boolean(fieldErrors.password)}
          helperText={t('invite.passwordHint')}
        />
        <Button type="submit" variant="contained" size="large" disabled={pending}>
          {t('invite.register')}
        </Button>
      </form>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent className="flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <Typography variant="h5" component="h1">
            {t('invite.title', { tenant: invitation.tenantName })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('invite.subtitle', { role: tRoles(invitation.role), email: invitation.email })}
          </Typography>
        </div>
        {body}
      </CardContent>
    </Card>
  );
}
