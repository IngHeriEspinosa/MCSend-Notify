/** Una importación: mapeo de columnas (pendiente) o progreso y resultado. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ImportMapper } from '@/components/organisms/ImportMapper';
import { ImportProgress } from '@/components/organisms/ImportProgress';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Import');
  return { title: t('title') };
}

export default async function ImportDetailPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/contacts/import/[importId]'>) {
  const { tenantSlug, importId } = await params;
  if (!z.uuid().safeParse(importId).success) notFound();
  const { context } = await requireTenant(tenantSlug);
  const t = await getTranslations('Import');

  const data = await useCases
    .getImport()
    .execute(context, importId)
    .catch((error: unknown) => {
      if (isDomainError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN'))
        notFound();
      throw error;
    });
  const { record } = data;

  if (record.status === 'UPLOADED') {
    const lists = await useCases.lists().list(context);
    return (
      <>
        <PageHeader
          title={t('mappingTitle')}
          subtitle={`${record.fileName} · ${t('mappingSubtitle')}`}
        />
        <ImportMapper
          tenantSlug={tenantSlug}
          importId={record.id}
          headers={record.headers}
          previewRows={record.previewRows}
          suggestedMapping={data.suggestedMapping}
          fields={data.fields.map((field) => ({ key: field.key, label: field.label }))}
          lists={lists.map((list) => ({ id: list.id, name: list.name }))}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('resultTitle')} subtitle={record.fileName} />
      <ImportProgress
        tenantSlug={tenantSlug}
        importId={record.id}
        initial={{
          status: record.status,
          totalRows: record.totalRows,
          createdCount: record.createdCount,
          updatedCount: record.updatedCount,
          skippedCount: record.skippedCount,
          invalidCount: record.invalidCount,
          hasErrorReport: record.errorReportKey !== null,
          error: record.error,
        }}
      />
    </>
  );
}
