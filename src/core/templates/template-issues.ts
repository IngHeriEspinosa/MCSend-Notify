/**
 * Comprobaciones previas al envío. Un `error` impedirá enviar (Fase 3); un `warning` informa.
 * Las detecta el compilador y la UI las muestra traducidas por su código.
 */
export const TEMPLATE_ISSUE_CODES = [
  'SUBJECT_TOO_LONG',
  'PREHEADER_MISSING',
  'LIQUID_SYNTAX',
  'UNKNOWN_VARIABLE',
  'IMAGE_MISSING_ALT',
  'INSECURE_LINK',
  'HTML_TOO_LARGE',
  'POSTAL_ADDRESS_MISSING',
  'DOCUMENT_UNAVAILABLE',
  'CONTENT_SANITIZED',
  'EMPTY_CONTENT',
] as const;

export type TemplateIssueCode = (typeof TEMPLATE_ISSUE_CODES)[number];

export type TemplateIssueSeverity = 'error' | 'warning';

export interface TemplateIssue {
  code: TemplateIssueCode;
  severity: TemplateIssueSeverity;
  /** Dato concreto para el mensaje (variable desconocida, tamaño en KB...). */
  detail?: string | undefined;
}

/** Gmail recorta los mensajes de más de 102 KB y oculta el resto (incluido el pie de baja). */
export const GMAIL_CLIP_BYTES = 102 * 1024;
export const SUBJECT_RECOMMENDED_MAX = 78;

export function hasBlockingIssues(
  issues: ReadonlyArray<{ severity: TemplateIssueSeverity }>,
): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
