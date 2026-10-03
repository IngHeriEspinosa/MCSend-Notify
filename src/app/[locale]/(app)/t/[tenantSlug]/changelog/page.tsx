/** Buzón de novedades del tenant: fuente del resumen semanal y de otras automatizaciones. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { getServerEnv } from '@/common/config/env';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ChangelogManager } from '@/components/organisms/ChangelogManager';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Changelog');
  return { title: t('pageTitle') };
}

export default async function ChangelogPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/changelog'>) {
  const { tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'changelog:read')) notFound();
  const t = await getTranslations('Changelog');
  const entries = await useCases.changelog().list(context);

  return (
    <>
      <PageHeader title={t('pageTitle')} subtitle={t('subtitle')} />
      <ChangelogManager
        tenantSlug={tenantSlug}
        entries={entries}
        canWrite={can(context.actor, 'changelog:write')}
        apiUrl={new URL('/api/v1/changelog', getServerEnv().APP_URL).toString()}
        timeZone={tenant.timezone}
      />
    </>
  );
}
