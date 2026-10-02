/**
 * Página de inicio pública (Fase 0). En la Fase 1 dirigirá al inicio de sesión
 * y a la selección de aplicación (tenant).
 */
import AppsOutlined from '@mui/icons-material/AppsOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import ScheduleSendOutlined from '@mui/icons-material/ScheduleSendOutlined';
import Typography from '@mui/material/Typography';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { FeatureCard } from '@/components/molecules/FeatureCard';
import { PublicHeader } from '@/components/organisms/PublicHeader';

const FEATURES = [
  { key: 'tenants', icon: <AppsOutlined /> },
  { key: 'ai', icon: <AutoAwesomeOutlined /> },
  { key: 'documents', icon: <DescriptionOutlined /> },
  { key: 'automation', icon: <ScheduleSendOutlined /> },
] as const;

export default function HomePage() {
  const t = useTranslations('Home');

  return (
    <>
      <PublicHeader />
      <main id="main-content" className="mx-auto flex max-w-6xl flex-col gap-14 px-4 py-14 sm:px-6">
        <section className="flex max-w-3xl flex-col gap-5">
          <Typography
            variant="overline"
            component="p"
            className="font-semibold tracking-widest text-primary"
          >
            {t('eyebrow')}
          </Typography>
          <Typography variant="h3" component="h1">
            {t('title')}
          </Typography>
          <Typography variant="h6" component="p" color="text.secondary" className="font-normal">
            {t('subtitle')}
          </Typography>
          <NextLink
            href="/api/health/ready"
            prefetch={false}
            className="w-fit rounded-lg bg-primary px-5 py-3 font-semibold text-primary-contrast transition-opacity hover:opacity-90"
          >
            {t('statusLink')}
          </NextLink>
        </section>

        <section aria-labelledby="features-title" className="flex flex-col gap-6">
          <Typography id="features-title" variant="h5" component="h2">
            {t('featuresTitle')}
          </Typography>
          <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ key, icon }) => (
              <li key={key}>
                <FeatureCard
                  icon={icon}
                  title={t(`features.${key}.title`)}
                  description={t(`features.${key}.description`)}
                />
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="border-t border-line py-6 text-center text-sm text-ink-muted">
        {t('footer')}
      </footer>
    </>
  );
}
