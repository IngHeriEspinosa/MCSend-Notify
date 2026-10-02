/** Datos auxiliares del formulario de contacto (campos, listas, etiquetas y temas). */
import 'server-only';
import type { TenantContext } from '@/core/shared/tenant-context';
import { useCases } from '@/infrastructure/use-case-factory';

export async function loadContactFormOptions(context: TenantContext) {
  const [fields, lists, tags, topics] = await Promise.all([
    useCases.contactFields().list(context),
    useCases.lists().list(context),
    useCases.tags().list(context),
    useCases.topics().list(context),
  ]);
  return {
    fields,
    lists: lists.map((list) => ({ id: list.id, name: list.name })),
    tags,
    topics,
  };
}

export type ContactFormOptions = Awaited<ReturnType<typeof loadContactFormOptions>>;
