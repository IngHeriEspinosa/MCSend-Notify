/**
 * Resultado tipado de las Server Actions, compartido por servidor y cliente.
 * No contiene dependencias de servidor para poder importarse desde componentes cliente.
 */
import type { DomainErrorCode } from '@/core/shared/domain-error';

export type ActionErrorCode = DomainErrorCode | 'UNEXPECTED';

export interface ActionError {
  code: ActionErrorCode;
  fields?: Record<string, string[] | undefined>;
  details?: Record<string, unknown>;
  traceId?: string;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
