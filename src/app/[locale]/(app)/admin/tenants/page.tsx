/** Administración de plataforma: aplicaciones (tenants). Solo SUPER_ADMIN. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requirePlatformAdmin } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { TenantsAdmin } from '@/components/organisms/TenantsAdmin';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Admin');
  return { title: t('tenantsTitle') };
}

export default async function AdminTenantsPage() {
  const user = await requirePlatformAdmin();
  const t = await getTranslations('Admin');
  const tenants = await useCases.listUserTenants().execute(user);

  return (
    <>
      <PageHeader title={t('tenantsTitle')} subtitle={t('tenantsSubtitle')} />
      <TenantsAdmin
        tenants={tenants.map(({ tenant }) => ({
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          defaultLocale: tenant.defaultLocale,
        }))}
      />
    </>
  );
}
