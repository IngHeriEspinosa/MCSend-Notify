/**
 * Destino de pino que reenvía a MCLog, por lotes, los registros de nivel `warn` o superior.
 *
 * Sigue las reglas de integración de MCLog: envío por lotes (cada 5 s o 200 entradas),
 * buffer acotado con descarte contado, excepción completa (clase, código y stack) y
 * nunca romper la aplicación si MCLog no responde.
 */
import type { MCLogClient, MCLogInput, MCLogLevel } from '@multicomputos-srl/mclog';

export type LogBatchSender = Pick<MCLogClient, 'sendBatch'>;

export interface MCLogBatchStreamOptions {
  sender: LogBatchSender;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxBufferSize?: number;
}

const PINO_LEVEL_WARN = 40;
const PINO_LEVEL_ERROR = 50;

/** Campos de pino que se transforman en campos propios de MCLog y no van a metadata. */
const RESERVED_FIELDS = new Set([
  'level',
  'time',
  'msg',
  'err',
  'traceId',
  'service',
  'pid',
  'hostname',
]);

interface PinoErrorShape {
  type?: string;
  message?: string;
  stack?: string;
  code?: string | number;
}

function toMCLogLevel(pinoLevel: number): MCLogLevel {
  if (pinoLevel >= PINO_LEVEL_ERROR) return 'error';
  if (pinoLevel >= PINO_LEVEL_WARN) return 'warn';
  return pinoLevel >= 30 ? 'info' : 'debug';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toTimestamp(time: unknown): string | undefined {
  if (typeof time === 'number' || typeof time === 'string') {
    const date = new Date(time);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

/** Convierte una línea JSON de pino en una entrada de MCLog. Devuelve null si no aplica. */
export function toMCLogEntry(line: string): MCLogInput | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(record) || typeof record.level !== 'number' || record.level < PINO_LEVEL_WARN) {
    return null;
  }

  const metadata = Object.fromEntries(
    Object.entries(record).filter(([key]) => !RESERVED_FIELDS.has(key)),
  );
  const error = isRecord(record.err) ? (record.err as PinoErrorShape) : undefined;

  return {
    level: toMCLogLevel(record.level),
    message: typeof record.msg === 'string' && record.msg ? record.msg : (error?.message ?? 'Log'),
    timestamp: toTimestamp(record.time),
    traceId: typeof record.traceId === 'string' ? record.traceId : undefined,
    service: typeof record.service === 'string' ? record.service : undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    error: error
      ? {
          name: error.type,
          message: error.message,
          stack: error.stack,
          code: error.code === undefined ? undefined : String(error.code),
        }
      : undefined,
  };
}

export class MCLogBatchStream {
  private buffer: MCLogInput[] = [];
  private readonly timer: NodeJS.Timeout;
  private readonly maxBatchSize: number;
  private readonly maxBufferSize: number;
  private dropped = 0;

  constructor(private readonly options: MCLogBatchStreamOptions) {
    this.maxBatchSize = options.maxBatchSize ?? 200;
    this.maxBufferSize = options.maxBufferSize ?? 1000;
    this.timer = setInterval(() => void this.flush(), options.flushIntervalMs ?? 5000);
    this.timer.unref();
  }

  /** Entradas descartadas porque el buffer estaba lleno. */
  get droppedCount(): number {
    return this.dropped;
  }

  /** Interfaz de destino de pino: recibe cada registro serializado como una línea JSON. */
  write(line: string): void {
    const entry = toMCLogEntry(line);
    if (!entry) return;

    if (this.buffer.length >= this.maxBufferSize) {
      this.dropped += 1;
      return;
    }
    this.buffer.push(entry);
    if (this.buffer.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  /** Envía lo acumulado. Nunca lanza: un fallo de MCLog no debe afectar a la aplicación. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.options.sender.sendBatch(batch);
    } catch {
      // El cliente de MCLog ya informa los fallos por su callback onError.
    }
  }

  /** Detiene el temporizador y envía lo pendiente (apagado ordenado). */
  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
  }
}
