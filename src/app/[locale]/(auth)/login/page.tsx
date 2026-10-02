/** Inicio de sesión: credenciales y/o Microsoft Entra ID según la configuración. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { safeRedirectPath } from '@/app/_server/action-client';
import { isCredentialsEnabled, isEntraEnabled } from '@/app/_server/auth';
import { getOptionalUser } from '@/app/_server/session';
import { LoginForm } from '@/components/organisms/LoginForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Auth');
  return { title: t('loginTitle') };
}

export default async function LoginPage({ params, searchParams }: PageProps<'/[locale]/login'>) {
  const { locale } = await params;
  const query = await searchParams;
  const callbackUrl = safeRedirectPath(query.callbackUrl, `/${locale}/select-tenant`);

  if (await getOptionalUser()) redirect(callbackUrl);

  // Auth.js redirige aquí con ?error=AccessDenied cuando el SSO se rechaza por dominio.
  const ssoDenied = query.error === 'AccessDenied';

  return (
    <LoginForm
      callbackUrl={callbackUrl}
      credentialsEnabled={isCredentialsEnabled()}
      entraEnabled={isEntraEnabled()}
      initialError={ssoDenied ? 'sso' : undefined}
    />
  );
}
