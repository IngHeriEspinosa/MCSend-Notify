/** Campañas del tenant. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { CampaignsTable } from '@/components/organisms/CampaignsTable';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Campaigns');
  return { title: t('title') };
}

export default async function CampaignsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/campaigns'>) {
  const { tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'campaign:read')) notFound();
  const t = await getTranslations('Campaigns');
  const canWrite = can(context.actor, 'campaign:write');
  const [campaigns, templates] = await Promise.all([
    useCases.campaigns().list(context),
    canWrite ? useCases.templates().list(context) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <CampaignsTable
        tenantSlug={tenantSlug}
        campaigns={campaigns}
        templates={templates.map((template) => ({ id: template.id, name: template.name }))}
        canWrite={canWrite}
        timeZone={tenant.timezone}
      />
    </>
  );
}
