/** Contactos de una lista, con la opción de quitarlos de ella. */
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ContactsDataGrid } from '@/components/organisms/ContactsDataGrid';
import { contactQuerySchema } from '@/core/contacts/contact';
import { can } from '@/core/identity/permissions';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export default async function ListDetailPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/lists/[listId]'>) {
  const { tenantSlug, listId } = await params;
  if (!z.uuid().safeParse(listId).success) notFound();
  const { context } = await requireTenant(tenantSlug);

  const list = await useCases
    .lists()
    .get(context, listId)
    .catch((error: unknown) => {
      if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    });
  const initialQuery = contactQuerySchema.parse({ listId });
  const [page, segments] = await Promise.all([
    useCases.listContacts().execute(context, initialQuery),
    useCases.segments().list(context),
  ]);

  return (
    <>
      <PageHeader title={list.name} subtitle={list.description ?? undefined} />
      <ContactsDataGrid
        tenantSlug={tenantSlug}
        initialPage={page}
        initialQuery={initialQuery}
        lists={[]}
        segments={segments.map((segment) => ({ id: segment.id, name: segment.name }))}
        canWrite={can(context.actor, 'list:write')}
        fixedListId={listId}
      />
    </>
  );
}
