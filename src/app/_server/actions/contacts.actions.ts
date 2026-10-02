'use server';

/** Server Actions de contactos. Permisos y validaciones de negocio viven en los casos de uso. */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import { contactInputSchema, contactQuerySchema } from '@/core/contacts/contact';
import { listMembershipSchema, tagSchema } from '@/core/contacts/use-cases/audience.use-cases';
import { useCases } from '@/infrastructure/use-case-factory';

export const listContactsAction = tenantAction(
  contactQuerySchema,
  (query, context) => useCases.listContacts().execute(context, query),
  { refresh: false },
);

export const createContactAction = tenantAction(contactInputSchema, async (input, context) => {
  const contact = await useCases.createContact().execute(context, input);
  return { id: contact.id };
});

export const updateContactAction = tenantAction(
  z.object({ id: z.uuid(), contact: contactInputSchema }),
  async ({ id, contact }, context) => {
    await useCases.updateContact().execute(context, id, contact);
    return { id };
  },
);

export const deleteContactAction = tenantAction(z.object({ id: z.uuid() }), ({ id }, context) =>
  useCases.deleteContact().execute(context, id),
);

export const addContactsToListAction = tenantAction(listMembershipSchema, (input, context) =>
  useCases.lists().addContacts(context, input),
);

export const removeContactsFromListAction = tenantAction(listMembershipSchema, (input, context) =>
  useCases.lists().removeContacts(context, input),
);

export const createTagAction = tenantAction(tagSchema, (input, context) =>
  useCases.tags().create(context, input),
);
