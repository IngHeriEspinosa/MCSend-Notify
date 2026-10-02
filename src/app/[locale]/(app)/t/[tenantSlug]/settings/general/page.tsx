/** Configuración general del tenant. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { TenantSettingsForm } from '@/components/organisms/TenantSettingsForm';
import { can } from '@/core/identity/permissions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings');
  return { title: t('generalTitle') };
}

export default async function GeneralSettingsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/general'>) {
  const { tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  const t = await getTranslations('Settings');

  return (
    <>
      <PageHeader title={t('generalTitle')} subtitle={t('generalSubtitle')} />
      <TenantSettingsForm
        tenantSlug={tenantSlug}
        canUpdate={can(context.actor, 'tenant:update')}
        initial={{
          name: tenant.name,
          defaultLocale: tenant.defaultLocale,
          timezone: tenant.timezone,
          postalAddress: tenant.postalAddress,
        }}
      />
    </>
  );
}
