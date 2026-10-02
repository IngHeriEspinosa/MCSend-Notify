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

export class DomainError extends Error {
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
  return error instanceof DomainError;
}
