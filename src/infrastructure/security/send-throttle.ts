/**
 * Límites de envío en Redis compartidos por todos los workers.
 *
 * - `rate`: GCRA (Generic Cell Rate Algorithm) con espaciado uniforme. Cada envío reserva el
 *   siguiente hueco (`durationSeconds / points`); en cualquier ventana deslizante caben como mucho
 *   `points` envíos (+1), sin las ráfagas de 2× que permite una ventana fija en su frontera.
 *   El script es atómico y usa el reloj de Redis, así que el ritmo es global aunque haya varios
 *   workers con relojes distintos.
 * - `quota`: contador por ventana fija (cupo diario del proveedor, límite por hora de campaña).
 */
import type { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import type { SendLimit, SendThrottle, ThrottleResult } from '@/core/campaigns/ports';

/** Devuelve 0 si concede el hueco, o los microsegundos que faltan para el siguiente. */
const GCRA_SCRIPT = `
local interval = tonumber(ARGV[1])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000000 + tonumber(time[2])
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat > now then
  return tat - now
end
redis.call('SET', KEYS[1], now + interval, 'PX', math.ceil(interval / 1000) + 1000)
return 0
`;

export class RedisSendThrottle implements SendThrottle {
  private readonly quotas = new Map<string, RateLimiterRedis>();

  constructor(private readonly redis: Redis) {}

  async acquire(scope: string, limits: ReadonlyArray<SendLimit>): Promise<ThrottleResult> {
    for (const limit of limits) {
      const waitMs =
        limit.mode === 'rate' ? await this.rate(scope, limit) : await this.quota(scope, limit);
      if (waitMs > 0) return { ok: false, retryAfterMs: Math.max(10, Math.ceil(waitMs)) };
    }
    return { ok: true };
  }

  private async rate(scope: string, { points, durationSeconds }: SendLimit): Promise<number> {
    const intervalUs = Math.floor((durationSeconds * 1_000_000) / points);
    const key = `send:rate:${scope}:${points}/${durationSeconds}`;
    const waitUs = Number(await this.redis.eval(GCRA_SCRIPT, 1, key, intervalUs));
    return waitUs / 1000;
  }

  private async quota(scope: string, { points, durationSeconds }: SendLimit): Promise<number> {
    const id = `${points}/${durationSeconds}`;
    let limiter = this.quotas.get(id);
    if (!limiter) {
      limiter = new RateLimiterRedis({
        storeClient: this.redis,
        keyPrefix: `send:${durationSeconds}`,
        points,
        duration: durationSeconds,
      });
      this.quotas.set(id, limiter);
    }
    try {
      await limiter.consume(`${scope}:${points}`);
      return 0;
    } catch (error) {
      if (error instanceof RateLimiterRes) return error.msBeforeNext;
      throw error;
    }
  }
}
