/** Temas de suscripción (centro de preferencias). */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { TopicsManager } from '@/components/organisms/AudienceSettingsManagers';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings');
  return { title: t('topicsTitle') };
}

export default async function TopicsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/topics'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'topic:manage')) notFound();
  const t = await getTranslations('Settings');

  return (
    <>
      <PageHeader title={t('topicsTitle')} subtitle={t('topicsSubtitle')} />
      <TopicsManager tenantSlug={tenantSlug} topics={await useCases.topics().list(context)} />
    </>
  );
}
