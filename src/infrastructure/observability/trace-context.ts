/**
 * Contexto de traza por petición o por job (AsyncLocalStorage). El logger añade el traceId
 * automáticamente, de modo que la app y el worker comparten la correlación de una operación.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface TraceContext {
  traceId: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

/** Ejecuta `operation` dentro del contexto de traza indicado. */
export function runWithTraceId<T>(traceId: string, operation: () => T): T {
  return storage.run({ traceId }, operation);
}

/** TraceId activo, si la ejecución actual está dentro de un contexto de traza. */
export function currentTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}
