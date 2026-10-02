/** Datos del editor de segmentos: campos personalizados, listas y etiquetas del tenant. */
import 'server-only';
import type { TenantContext } from '@/core/shared/tenant-context';
import { useCases } from '@/infrastructure/use-case-factory';

export async function loadSegmentEditorOptions(context: TenantContext) {
  const [fields, lists, tags] = await Promise.all([
    useCases.contactFields().list(context),
    useCases.lists().list(context),
    useCases.tags().list(context),
  ]);
  return {
    fields,
    lists: lists.map((list) => ({ id: list.id, name: list.name })),
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
  };
}
