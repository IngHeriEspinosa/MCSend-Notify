/** Campos personalizados de contacto. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ContactFieldsManager } from '@/components/organisms/AudienceSettingsManagers';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings');
  return { title: t('fieldsTitle') };
}

export default async function FieldsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/fields'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'field:manage')) notFound();
  const t = await getTranslations('Settings');

  return (
    <>
      <PageHeader title={t('fieldsTitle')} subtitle={t('fieldsSubtitle')} />
      <ContactFieldsManager
        tenantSlug={tenantSlug}
        fields={await useCases.contactFields().list(context)}
      />
    </>
  );
}
