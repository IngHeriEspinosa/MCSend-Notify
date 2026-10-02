/** Aceptación de invitaciones: registro (sin cuenta) o aceptación con la sesión actual. */
import Alert from '@mui/material/Alert';
import { getTranslations } from 'next-intl/server';
import { getOptionalUser } from '@/app/_server/session';
import { InviteAcceptance } from '@/components/organisms/InviteAcceptance';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export default async function InvitePage({ params }: PageProps<'/[locale]/invite/[token]'>) {
  const { token } = await params;
  const t = await getTranslations('Auth.invite');

  let invitation: Awaited<ReturnType<ReturnType<typeof useCases.getInvitation>['execute']>>;
  try {
    invitation = await useCases.getInvitation().execute(token);
  } catch (error) {
    if (isDomainError(error)) return <Alert severity="warning">{t('invalid')}</Alert>;
    throw error;
  }

  const user = await getOptionalUser();
  return (
    <InviteAcceptance
      token={token}
      invitation={{
        email: invitation.email,
        role: invitation.role,
        tenantName: invitation.tenantName,
        hasAccount: invitation.hasAccount,
      }}
      sessionEmail={user?.email ?? null}
    />
  );
}
