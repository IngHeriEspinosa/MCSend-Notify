/** Biblioteca de documentos del tenant. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { DocumentsManager } from '@/components/organisms/DocumentsManager';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Documents');
  return { title: t('title') };
}

export default async function DocumentsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/documents'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'document:read')) notFound();
  const t = await getTranslations('Documents');
  const documents = await useCases.documents().list(context, {});

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DocumentsManager
        tenantSlug={tenantSlug}
        documents={documents}
        canWrite={can(context.actor, 'document:write')}
      />
    </>
  );
}
