/**
 * Modelos con columna `tenantId` y sus campos de relación.
 * src/infrastructure/persistence/prisma/tenant-models.test.ts compara esta lista con
 * prisma/schema.prisma: añadir una tabla de negocio sin registrarla aquí rompe los tests.
 */
export const TENANT_MODEL_RELATIONS = {
  TenantMembership: ['tenant', 'user'],
  Invitation: ['tenant'],
  ApiKey: ['tenant'],
  AuditLog: [],
  Contact: ['tenant', 'listMemberships', 'tags', 'topicSubscriptions'],
  ContactField: ['tenant'],
  ContactList: ['tenant', 'memberships', 'imports'],
  ListMembership: ['list', 'contact'],
  Tag: ['tenant', 'contacts'],
  ContactTag: ['contact', 'tag'],
  Segment: ['tenant'],
  Topic: ['tenant', 'subscriptions'],
  ContactTopicSubscription: ['contact', 'topic'],
  Suppression: ['tenant'],
  ContactImport: ['tenant', 'list'],
} as const satisfies Record<string, readonly string[]>;

export type TenantModelName = keyof typeof TENANT_MODEL_RELATIONS;

export function isTenantModel(model: string): model is TenantModelName {
  return Object.hasOwn(TENANT_MODEL_RELATIONS, model);
}
