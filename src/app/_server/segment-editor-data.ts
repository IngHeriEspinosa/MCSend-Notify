/**
 * Datos del editor de segmentos: campos personalizados, listas y etiquetas del tenant, y si la
 * persona puede describir la audiencia con IA.
 */
import 'server-only';
import { can } from '@/core/identity/permissions';
import type { TenantContext } from '@/core/shared/tenant-context';
import { useCases } from '@/infrastructure/use-case-factory';

export async function loadSegmentEditorOptions(context: TenantContext) {
  const [fields, lists, tags, aiEnabled] = await Promise.all([
    useCases.contactFields().list(context),
    useCases.lists().list(context),
    useCases.tags().list(context),
    can(context.actor, 'ai:use') && can(context.actor, 'segment:write')
      ? useCases.aiSettings().isEnabled(context)
      : false,
  ]);
  return {
    fields,
    lists: lists.map((list) => ({ id: list.id, name: list.name })),
    tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
    aiEnabled,
  };
}
