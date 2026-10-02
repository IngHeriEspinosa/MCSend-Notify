/**
 * Identificador de traza que viaja entre la app, las colas y el worker (cabecera `x-trace-id`).
 * Un valor entrante solo se acepta si tiene un formato seguro; si no, se genera uno nuevo.
 */
export const TRACE_ID_HEADER = 'x-trace-id';

const SAFE_TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function generateTraceId(): string {
  return crypto.randomUUID();
}

/** Reutiliza el traceId entrante si es válido; en otro caso devuelve uno nuevo. */
export function resolveTraceId(incoming: string | null | undefined): string {
  return incoming && SAFE_TRACE_ID.test(incoming) ? incoming : generateTraceId();
}
