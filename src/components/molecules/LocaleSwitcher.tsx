'use client';

/** Selector de idioma que conserva la ruta actual. */
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/common/i18n/navigation';
import { routing } from '@/common/i18n/routing';

export function LocaleSwitcher() {
  const t = useTranslations('Common');
  const currentLocale = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t('language')} className="flex items-center gap-1">
      {routing.locales.map((locale) => {
        const isCurrent = locale === currentLocale;
        const stateClasses = isCurrent
          ? 'bg-primary text-primary-contrast'
          : 'text-ink-muted hover:text-primary';
        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            lang={locale}
            aria-current={isCurrent ? 'true' : undefined}
            className={`rounded-md px-2 py-1 text-sm font-semibold uppercase transition-colors ${stateClasses}`}
          >
            <span aria-hidden="true">{locale}</span>
            <span className="sr-only">{t(`languages.${locale}`)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
