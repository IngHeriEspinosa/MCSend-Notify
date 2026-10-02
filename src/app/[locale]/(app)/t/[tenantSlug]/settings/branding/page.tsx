/** Identidad visual de los correos del tenant. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { BrandingForm } from '@/components/organisms/BrandingForm';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Branding');
  return { title: t('title') };
}

export default async function BrandingPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/branding'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  const t = await getTranslations('Branding');
  const profile = await useCases.branding().get(context);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <BrandingForm
        tenantSlug={tenantSlug}
        branding={{
          primary: profile.branding.primary,
          accent: profile.branding.accent,
          footerMd: profile.branding.footerMd,
        }}
        logoUrl={profile.logoUrl}
        postalAddressMissing={!profile.postalAddress}
        canWrite={can(context.actor, 'tenant:update')}
      />
    </>
  );
}
