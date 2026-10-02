/** Edición de un segmento. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { loadSegmentEditorOptions } from '@/app/_server/segment-editor-data';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { SegmentEditor } from '@/components/organisms/SegmentEditor';
import { can } from '@/core/identity/permissions';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Segments');
  return { title: t('editTitle') };
}

export default async function EditSegmentPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/segments/[segmentId]'>) {
  const { tenantSlug, segmentId } = await params;
  if (!z.uuid().safeParse(segmentId).success) notFound();
  const { context } = await requireTenant(tenantSlug);
  const t = await getTranslations('Segments');

  const segment = await useCases
    .segments()
    .get(context, segmentId)
    .catch((error: unknown) => {
      if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    });

  return (
    <>
      <PageHeader title={t('editTitle')} subtitle={segment.name} />
      <SegmentEditor
        tenantSlug={tenantSlug}
        canWrite={can(context.actor, 'segment:write')}
        segment={{
          id: segment.id,
          name: segment.name,
          description: segment.description,
          rules: segment.rules,
        }}
        {...await loadSegmentEditorOptions(context)}
      />
    </>
  );
}
