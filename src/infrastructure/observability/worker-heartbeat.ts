/**
 * Latido del worker en Redis. El worker lo actualiza periódicamente mediante un job programado
 * (lo que prueba a la vez Redis y el procesamiento de colas) y la app lo consulta en su readiness.
 */
import type { HealthCheck } from './readiness';

export const WORKER_HEARTBEAT_KEY = 'mcsn:worker:heartbeat';

/** Un latido más antiguo que esto indica que el worker no está procesando. */
export const WORKER_HEARTBEAT_MAX_AGE_MS = 3 * 60 * 1000;

/** Subconjunto de Redis que necesita el latido (lo cumple `ioredis`). */
export interface HeartbeatRedis {
  set(key: string, value: string, expiryMode: 'PX', milliseconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}

export class WorkerHeartbeat {
  constructor(private readonly redis: HeartbeatRedis) {}

  async beat(at: Date = new Date()): Promise<void> {
    await this.redis.set(
      WORKER_HEARTBEAT_KEY,
      String(at.getTime()),
      'PX',
      WORKER_HEARTBEAT_MAX_AGE_MS * 2,
    );
  }

  /** Antigüedad del último latido en ms, o null si no hay ninguno registrado. */
  async ageMs(now: Date = new Date()): Promise<number | null> {
    const value = await this.redis.get(WORKER_HEARTBEAT_KEY);
    if (value === null) return null;
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? now.getTime() - timestamp : null;
  }
}

/** Comprobación no crítica: la web puede servir aunque el worker esté detenido. */
export function workerHeartbeatHealthCheck(heartbeat: WorkerHeartbeat): HealthCheck {
  return {
    name: 'worker',
    critical: false,
    async check() {
      const age = await heartbeat.ageMs();
      if (age === null || age > WORKER_HEARTBEAT_MAX_AGE_MS) {
        throw new Error('El worker no ha reportado latido reciente');
      }
    },
  };
}
