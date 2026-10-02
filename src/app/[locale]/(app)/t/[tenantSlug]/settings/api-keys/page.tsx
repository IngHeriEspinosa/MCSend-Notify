/** Claves de API del tenant. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ApiKeysManager } from '@/components/organisms/ApiKeysManager';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings');
  return { title: t('apiKeysTitle') };
}

export default async function ApiKeysPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/api-keys'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'apikey:manage')) notFound();
  const t = await getTranslations('Settings');

  return (
    <>
      <PageHeader title={t('apiKeysTitle')} subtitle={t('apiKeysSubtitle')} />
      <ApiKeysManager tenantSlug={tenantSlug} apiKeys={await useCases.apiKeys().list(context)} />
    </>
  );
}
