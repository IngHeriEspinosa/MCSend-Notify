/** Listas estáticas de contactos. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ListsManager } from '@/components/organisms/ListsManager';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Lists');
  return { title: t('title') };
}

export default async function ListsPage({ params }: PageProps<'/[locale]/t/[tenantSlug]/lists'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  const t = await getTranslations('Lists');
  const lists = await useCases.lists().list(context);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ListsManager
        tenantSlug={tenantSlug}
        lists={lists}
        canWrite={can(context.actor, 'list:write')}
      />
    </>
  );
}
