/** Cabecera de las páginas públicas: salto al contenido, logotipo, idioma y tema. */
import { useTranslations } from 'next-intl';
import { BrandLogo } from '@/components/atoms/BrandLogo';
import { LocaleSwitcher } from '@/components/molecules/LocaleSwitcher';
import { ThemeToggle } from '@/components/molecules/ThemeToggle';

export function PublicHeader() {
  const t = useTranslations('Common');

  return (
    <header className="border-b border-line bg-paper">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-secondary focus:px-4 focus:py-2 focus:text-secondary-contrast"
      >
        {t('skipToContent')}
      </a>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <BrandLogo alt={t('brandAlt')} width={200} priority />
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
