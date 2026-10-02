/** Solicitud del enlace de recuperación de contraseña. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isCredentialsEnabled } from '@/app/_server/auth';
import { ForgotPasswordForm } from '@/components/organisms/PasswordResetForms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('PasswordReset');
  return { title: t('forgotTitle'), robots: { index: false } };
}

export default function ForgotPasswordPage() {
  if (!isCredentialsEnabled()) notFound();
  return <ForgotPasswordForm />;
}
