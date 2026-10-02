/** Detalle y edición de un contacto. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { loadContactFormOptions } from '@/app/_server/contact-form-data';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ContactForm } from '@/components/organisms/ContactForm';
import { can } from '@/core/identity/permissions';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ContactForm');
  return { title: t('editTitle') };
}

export default async function ContactDetailPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/contacts/[contactId]'>) {
  const { tenantSlug, contactId } = await params;
  if (!z.uuid().safeParse(contactId).success) notFound();
  const { context } = await requireTenant(tenantSlug);

  const contact = await useCases
    .getContact()
    .execute(context, contactId)
    .catch((error: unknown) => {
      if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    });

  return (
    <>
      <PageHeader title={contact.email} />
      <ContactForm
        tenantSlug={tenantSlug}
        options={await loadContactFormOptions(context)}
        contact={contact}
        canWrite={can(context.actor, 'contact:write')}
        canDelete={can(context.actor, 'contact:delete')}
      />
    </>
  );
}
