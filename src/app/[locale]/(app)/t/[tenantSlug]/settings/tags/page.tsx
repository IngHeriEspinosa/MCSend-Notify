/** Etiquetas de contactos. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { TagsManager } from '@/components/organisms/AudienceSettingsManagers';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings');
  return { title: t('tagsTitle') };
}

export default async function TagsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/tags'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'contact:write')) notFound();
  const t = await getTranslations('Settings');

  return (
    <>
      <PageHeader title={t('tagsTitle')} subtitle={t('tagsSubtitle')} />
      <TagsManager tenantSlug={tenantSlug} tags={await useCases.tags().list(context)} />
    </>
  );
}
