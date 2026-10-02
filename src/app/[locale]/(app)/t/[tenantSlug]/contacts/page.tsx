/** Listado de contactos del tenant con filtros (búsqueda, estado, lista y segmento). */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/app/_server/session';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ContactsDataGrid } from '@/components/organisms/ContactsDataGrid';
import { contactQuerySchema } from '@/core/contacts/contact';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Contacts');
  return { title: t('title') };
}

export default async function ContactsPage({
  params,
  searchParams,
}: PageProps<'/[locale]/t/[tenantSlug]/contacts'>) {
  const { tenantSlug } = await params;
  const search = await searchParams;
  const { context } = await requireTenant(tenantSlug);
  const t = await getTranslations('Contacts');

  // Filtros iniciales desde la URL (p. ej. "Ver contactos" de un segmento); se validan con Zod.
  const initialQuery = contactQuerySchema.parse({
    segmentId: contactQuerySchema.shape.segmentId.safeParse(search.segmentId).data,
    listId: contactQuerySchema.shape.listId.safeParse(search.listId).data,
  });

  const [page, lists, segments] = await Promise.all([
    useCases.listContacts().execute(context, initialQuery),
    useCases.lists().list(context),
    useCases.segments().list(context),
  ]);
  const canWrite = can(context.actor, 'contact:write');

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            {can(context.actor, 'contact:import') ? (
              <LinkButton href={`/t/${tenantSlug}/contacts/import`} variant="outlined">
                {t('import')}
              </LinkButton>
            ) : null}
            {canWrite ? (
              <LinkButton href={`/t/${tenantSlug}/contacts/new`} variant="contained">
                {t('new')}
              </LinkButton>
            ) : null}
          </>
        }
      />
      <ContactsDataGrid
        tenantSlug={tenantSlug}
        initialPage={page}
        initialQuery={initialQuery}
        lists={lists.map((list) => ({ id: list.id, name: list.name }))}
        segments={segments.map((segment) => ({ id: segment.id, name: segment.name }))}
        canWrite={canWrite}
      />
    </>
  );
}
