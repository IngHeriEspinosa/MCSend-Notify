/** Centro de preferencias de un destinatario (público, autorizado por el token firmado del correo). */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PreferencesForm } from '@/components/organisms/PreferencesForm';
import { getTrackingLinks } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Preferences');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function PreferencesPage({
  params,
  searchParams,
}: PageProps<'/[locale]/preferences/[token]'>) {
  const { token } = await params;
  const query = await searchParams;
  const payload = getTrackingLinks().verify(token, 'u');
  if (!payload) notFound();
  const preferences = await useCases.tracking().preferences(payload.t, payload.d);
  if (!preferences) notFound();

  return (
    <PreferencesForm
      token={token}
      tenantName={preferences.tenantName}
      email={preferences.email}
      unsubscribedAll={preferences.unsubscribedAll}
      intentUnsubscribe={query.intent === 'unsubscribe'}
      topics={preferences.topics}
    />
  );
}
