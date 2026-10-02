/**
 * Documento HTML por idioma: fuentes de marca, script de esquema de color (sin parpadeo),
 * tema MUI y mensajes de next-intl. El nonce de CSP llega desde `src/proxy.ts`.
 */
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import type { Metadata } from 'next';
import { Carlito, Montserrat } from 'next/font/google';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/common/i18n/routing';
import { AppThemeProvider } from '@/common/theme/app-theme-provider';
import '@/common/global/globals.css';

const headingFont = Montserrat({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-brand-heading',
  display: 'swap',
});

const bodyFont = Carlito({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-brand-body',
  display: 'swap',
});

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'Metadata' });
  return {
    title: { default: t('title'), template: `%s · ${t('title')}` },
    description: t('description'),
    applicationName: t('title'),
    authors: [{ name: 'Ing. Heri Espinosa' }],
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${headingFont.variable} ${bodyFont.variable}`}
    >
      <body className="min-h-screen antialiased">
        <InitColorSchemeScript attribute="class" defaultMode="system" nonce={nonce} />
        <AppThemeProvider nonce={nonce}>
          <NextIntlClientProvider>{children}</NextIntlClientProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
