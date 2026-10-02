/** Segmentos dinámicos del tenant. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/app/_server/session';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { SegmentsTable } from '@/components/organisms/SegmentsTable';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Segments');
  return { title: t('title') };
}

export default async function SegmentsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/segments'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  const t = await getTranslations('Segments');
  const segments = await useCases.segments().list(context);
  const canWrite = can(context.actor, 'segment:write');

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canWrite ? (
            <LinkButton href={`/t/${tenantSlug}/segments/new`} variant="contained">
              {t('new')}
            </LinkButton>
          ) : undefined
        }
      />
      <SegmentsTable
        tenantSlug={tenantSlug}
        canWrite={canWrite}
        segments={segments.map(({ id, name, description, lastCount, lastCountedAt }) => ({
          id,
          name,
          description,
          lastCount,
          lastCountedAt,
        }))}
      />
    </>
  );
}
