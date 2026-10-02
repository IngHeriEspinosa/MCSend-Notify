/**
 * Logger estructurado (pino) con redacción de secretos y traceId automático.
 * Escribe JSON en stdout y, opcionalmente, en destinos adicionales (p. ej. MCLog).
 */
import pino, { type DestinationStream, type Level, type Logger, type StreamEntry } from 'pino';
import { currentTraceId } from './trace-context';

export type { Logger };

/** Rutas que nunca deben llegar a los logs en claro (OWASP A09). */
export const REDACTED_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'apiKey',
  '*.apiKey',
  'credentials',
  '*.credentials',
  'secret',
  '*.secret',
  'token',
  '*.token',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'headers.authorization',
  'headers.cookie',
];

export interface LoggerOptions {
  level: Level;
  service: string;
  /** Destino principal; por defecto stdout. */
  baseStream?: DestinationStream;
  /** Destinos adicionales con su nivel mínimo. */
  extraStreams?: StreamEntry[];
}

export function createLogger({
  level,
  service,
  baseStream,
  extraStreams = [],
}: LoggerOptions): Logger {
  const streams: StreamEntry[] = [{ level, stream: baseStream ?? process.stdout }, ...extraStreams];

  return pino(
    {
      level,
      base: { service },
      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
      mixin() {
        const traceId = currentTraceId();
        return traceId ? { traceId } : {};
      },
    },
    pino.multistream(streams),
  );
}
