/** Webhooks salientes del tenant. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { WebhooksManager } from '@/components/organisms/WebhooksManager';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Webhooks');
  return { title: t('title') };
}

export default async function WebhooksPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/webhooks'>) {
  const { tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'webhook:manage')) notFound();
  const t = await getTranslations('Webhooks');

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <WebhooksManager
        tenantSlug={tenantSlug}
        endpoints={await useCases.webhooks().list(context)}
        timeZone={tenant.timezone}
      />
    </>
  );
}
