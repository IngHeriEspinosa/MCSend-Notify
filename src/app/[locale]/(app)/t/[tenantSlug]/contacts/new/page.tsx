/** Alta manual de un contacto. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { loadContactFormOptions } from '@/app/_server/contact-form-data';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ContactForm } from '@/components/organisms/ContactForm';
import { can } from '@/core/identity/permissions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ContactForm');
  return { title: t('newTitle') };
}

export default async function NewContactPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/contacts/new'>) {
  const { tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'contact:write')) notFound();
  const t = await getTranslations('ContactForm');

  return (
    <>
      <PageHeader title={t('newTitle')} />
      <ContactForm
        tenantSlug={tenantSlug}
        options={await loadContactFormOptions(context)}
        canWrite
        canDelete={false}
      />
    </>
  );
}
