/**
 * Motivos de error de dominio (`details.reason`) con mensaje propio en `Errors.reasons.*`.
 * La lista tipada permite traducirlos sin claves dinámicas sin comprobar.
 */
export const ERROR_REASONS = [
  'AI_NOT_CONFIGURED',
  'AI_BUDGET_EXCEEDED',
  'AI_BUDGET_ABOVE_PLATFORM',
  'AI_AUTH',
  'AI_CONFIG',
  'AI_PROVIDER_BUSY',
  'AI_REFUSED',
  'AI_INVALID_OUTPUT',
  'AI_UNAVAILABLE',
  'AI_UNSUPPORTED_FORMAT',
  'AI_SAME_LOCALE',
  'AI_SEGMENT_INVALID',
  'SOURCE_BLOCKED',
  'SOURCE_UNAVAILABLE',
  'SOURCE_DOCUMENT',
  'SOURCES_EMPTY',
  'SOURCES_COUNT',
  'INVALID_APPROVER',
  'NOT_APPROVER',
  'APPROVAL_DECIDED',
  'TEMPLATE_CHANGED',
  'NO_RECIPIENTS',
  'BLOCKING_ISSUES',
  'UNEXPECTED',
] as const;

export type ErrorReason = (typeof ERROR_REASONS)[number];

export function isErrorReason(value: unknown): value is ErrorReason {
  return typeof value === 'string' && (ERROR_REASONS as readonly string[]).includes(value);
}
