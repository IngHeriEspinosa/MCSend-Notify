/** Elección de una contraseña nueva con el enlace recibido por correo. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { isCredentialsEnabled } from '@/app/_server/auth';
import { ResetPasswordForm } from '@/components/organisms/PasswordResetForms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('PasswordReset');
  return { title: t('resetTitle'), robots: { index: false } };
}

export default async function ResetPasswordPage({
  params,
}: PageProps<'/[locale]/reset-password/[token]'>) {
  const { token } = await params;
  if (!isCredentialsEnabled() || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) notFound();
  return <ResetPasswordForm token={token} />;
}
