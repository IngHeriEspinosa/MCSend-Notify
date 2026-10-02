/** Proveedores de correo del tenant (solo propietarios y administradores). */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { getServerEnv } from '@/common/config/env';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ProvidersManager } from '@/components/organisms/ProvidersManager';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Providers');
  return { title: t('title') };
}

export default async function ProvidersPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/providers'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'provider:manage')) notFound();
  const t = await getTranslations('Providers');
  const providers = await useCases.providers().list(context);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ProvidersManager
        tenantSlug={tenantSlug}
        providers={providers}
        webhookBaseUrl={new URL('/api/webhooks/email/', getServerEnv().APP_URL).toString()}
      />
    </>
  );
}
