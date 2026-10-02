/** Remitentes del tenant y comprobación DNS de sus dominios. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { SendersManager } from '@/components/organisms/SendersManager';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Senders');
  return { title: t('title') };
}

export default async function SendersPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/senders'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'sender:manage')) notFound();
  const t = await getTranslations('Senders');
  const [senders, providers] = await Promise.all([
    useCases.senders().list(context),
    useCases.providers().list(context),
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <SendersManager
        tenantSlug={tenantSlug}
        senders={senders}
        providers={providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          kind: provider.kind,
        }))}
      />
    </>
  );
}
