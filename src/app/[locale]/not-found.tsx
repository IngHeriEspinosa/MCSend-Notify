import { useTranslations } from 'next-intl';
import { Link } from '@/common/i18n/navigation';

export default function LocaleNotFound() {
  const t = useTranslations('NotFound');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-heading text-6xl font-bold text-primary">404</p>
      <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
      <p className="max-w-md text-ink-muted">{t('description')}</p>
      <Link href="/" className="font-semibold text-primary underline-offset-4 hover:underline">
        {t('backHome')}
      </Link>
    </main>
  );
}
