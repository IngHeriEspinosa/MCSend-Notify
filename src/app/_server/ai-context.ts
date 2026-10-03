/**
 * Datos para mostrar las acciones de IA en una página: si la IA está disponible para el usuario
 * (configurada en el tenant y con permiso `ai:use`) y los documentos listos que puede usar como
 * fuente. Ocultar el botón es solo comodidad: cada acción vuelve a comprobar permisos.
 */
import 'server-only';
import { can } from '@/core/identity/permissions';
import type { TenantContext } from '@/core/shared/tenant-context';
import { useCases } from '@/infrastructure/use-case-factory';

export interface AiPageContext {
  enabled: boolean;
  documents: Array<{ id: string; title: string }>;
}

export async function getAiPageContext(context: TenantContext): Promise<AiPageContext> {
  if (!can(context.actor, 'ai:use') || !(await useCases.aiSettings().isEnabled(context))) {
    return { enabled: false, documents: [] };
  }
  const documents = can(context.actor, 'document:read')
    ? await useCases.documents().list(context, { status: 'READY' })
    : [];
  return {
    enabled: true,
    documents: documents.map((document) => ({ id: document.id, title: document.title })),
  };
}
