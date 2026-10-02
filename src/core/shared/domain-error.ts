/**
 * Error de dominio con un código estable. La capa de presentación traduce el código
 * a un mensaje i18n (`Errors.<code>`); el mensaje interno solo se registra en los logs.
 */
export const DOMAIN_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION',
  'RATE_LIMITED',
  'INVALID_STATE',
  'EXPIRED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/**
 * Marca global (registro de `Symbol.for`): Next.js puede cargar este módulo en varias capas
 * (páginas, route handlers) y los casos de uso memoizados en `globalThis` lanzan la clase de otra
 * copia. `instanceof` fallaría entre copias; la marca no.
 */
const DOMAIN_ERROR_BRAND = Symbol.for('mc-send-notify.DomainError');

export class DomainError extends Error {
  readonly [DOMAIN_ERROR_BRAND] = true;

  constructor(
    readonly code: DomainErrorCode,
    message: string,
    /** Detalles seguros de mostrar (p. ej. campos inválidos). Nunca datos sensibles. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isDomainError(error: unknown): error is DomainError {
  if (error instanceof DomainError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    DOMAIN_ERROR_BRAND in error &&
    error[DOMAIN_ERROR_BRAND] === true
  );
}
