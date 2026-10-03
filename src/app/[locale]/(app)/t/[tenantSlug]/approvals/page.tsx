/** Aprobaciones de campañas generadas por automatizaciones. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ApprovalsTable } from '@/components/organisms/ApprovalsTable';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Approvals');
  return { title: t('title') };
}

export default async function ApprovalsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/approvals'>) {
  const { tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'campaign:read')) notFound();
  const t = await getTranslations('Approvals');
  const approvals = await useCases.approvals().list(context, null);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ApprovalsTable tenantSlug={tenantSlug} approvals={approvals} timeZone={tenant.timezone} />
    </>
  );
}
