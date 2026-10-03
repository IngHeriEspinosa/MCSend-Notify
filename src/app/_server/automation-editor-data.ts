/**
 * Opciones del editor de automatizaciones: listas, segmentos, temas, remitentes, aprobadores
 * (miembros con permiso de envío) y documentos listos para usar como fuente.
 */
import 'server-only';
import { ROLE_PERMISSIONS } from '@/core/identity/permissions';
import type { TenantContext } from '@/core/shared/tenant-context';
import { useCases } from '@/infrastructure/use-case-factory';
import { getAiPageContext } from './ai-context';

export async function loadAutomationEditorOptions(context: TenantContext, locale: string) {
  const [lists, segments, topics, senders, { members }, ai] = await Promise.all([
    useCases.lists().list(context),
    useCases.segments().list(context),
    useCases.topics().list(context),
    useCases.senders().list(context),
    useCases.listMembers().execute(context),
    getAiPageContext(context),
  ]);
  return {
    lists: lists.map((list) => ({ id: list.id, label: `${list.name} (${list.memberCount})` })),
    segments: segments.map((segment) => ({ id: segment.id, label: segment.name })),
    topics: topics.map((topic) => ({
      id: topic.id,
      label: locale === 'en' ? topic.name.en : topic.name.es,
    })),
    senders: senders.map((sender) => ({
      id: sender.id,
      label: `${sender.fromName} <${sender.fromEmail}>`,
    })),
    approvers: members
      .filter((member) => ROLE_PERMISSIONS[member.role].has('campaign:send'))
      .map((member) => ({
        id: member.userId,
        label: member.name ? `${member.name} <${member.email}>` : member.email,
      })),
    documents: ai.documents,
    aiEnabled: ai.enabled,
  };
}
