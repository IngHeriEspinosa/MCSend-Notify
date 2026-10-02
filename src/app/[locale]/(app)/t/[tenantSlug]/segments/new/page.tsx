/** Creación de un segmento. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { loadSegmentEditorOptions } from '@/app/_server/segment-editor-data';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { SegmentEditor } from '@/components/organisms/SegmentEditor';
import { can } from '@/core/identity/permissions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Segments');
  return { title: t('new') };
}

export default async function NewSegmentPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/segments/new'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'segment:write')) notFound();
  const t = await getTranslations('Segments');

  return (
    <>
      <PageHeader title={t('new')} subtitle={t('subtitle')} />
      <SegmentEditor
        tenantSlug={tenantSlug}
        canWrite
        {...await loadSegmentEditorOptions(context)}
      />
    </>
  );
}
