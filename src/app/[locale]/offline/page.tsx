/**
 * Página sin conexión. El service worker la precarga y la muestra cuando una navegación falla
 * por falta de red. No muestra datos de ningún tenant.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/common/i18n/routing';
import { BrandLogo } from '@/components/atoms/BrandLogo';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Pwa');
  return { title: t('offlineTitle'), robots: { index: false } };
}

export default async function OfflinePage({ params }: PageProps<'/[locale]/offline'>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, common] = await Promise.all([getTranslations('Pwa'), getTranslations('Common')]);

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-6 px-4 text-center"
    >
      <BrandLogo alt={common('brandAlt')} priority />
      <h1 className="font-heading text-2xl font-bold">{t('offlineTitle')}</h1>
      <p className="text-ink-muted">{t('offlineBody')}</p>
      <a
        href={`/${locale}`}
        className="rounded-lg bg-primary px-5 py-3 font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t('retry')}
      </a>
    </main>
  );
}
