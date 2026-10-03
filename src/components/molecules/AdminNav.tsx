'use client';

/** Navegación del panel de plataforma (pestañas como enlaces, con la página actual marcada). */
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/common/i18n/navigation';

const ITEMS = [
  { key: 'tenants', href: '/admin/tenants' },
  { key: 'queues', href: '/admin/queues' },
  { key: 'aiUsage', href: '/admin/ai-usage' },
] as const;

export function AdminNav() {
  const t = useTranslations('Admin.nav');
  const pathname = usePathname();

  return (
    <nav aria-label={t('label')}>
      <ul className="flex flex-wrap gap-2 border-b border-line">
        {ITEMS.map((item) => {
          const current = pathname.startsWith(item.href);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`-mb-px inline-block border-b-2 px-3 py-2 font-semibold no-underline focus-visible:outline-2 ${
                  current
                    ? 'border-primary text-primary'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
