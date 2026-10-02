/**
 * Limitación de peticiones en Redis (OWASP A04/A07): inicio de sesión, API pública y subidas.
 * Compartida entre réplicas de la app porque el contador vive en Redis.
 */
import type { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { DomainError } from '@/core/shared/domain-error';

export interface RateLimitPolicy {
  keyPrefix: string;
  points: number;
  durationSeconds: number;
}

export const RATE_LIMITS = {
  login: { keyPrefix: 'rl:login', points: 10, durationSeconds: 15 * 60 },
  publicApi: { keyPrefix: 'rl:api', points: 600, durationSeconds: 60 },
  upload: { keyPrefix: 'rl:upload', points: 20, durationSeconds: 60 * 60 },
  documentUpload: { keyPrefix: 'rl:docs', points: 60, durationSeconds: 60 * 60 },
  invitation: { keyPrefix: 'rl:invite', points: 20, durationSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export class RateLimiter {
  private readonly limiter: RateLimiterRedis;

  constructor(redis: Redis, policy: RateLimitPolicy) {
    this.limiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: policy.keyPrefix,
      points: policy.points,
      duration: policy.durationSeconds,
    });
  }

  /** Consume un punto; lanza RATE_LIMITED con los segundos de espera si se supera el límite. */
  async consume(key: string): Promise<void> {
    try {
      await this.limiter.consume(key);
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        throw new DomainError('RATE_LIMITED', 'Demasiadas peticiones', {
          retryAfterSeconds: Math.ceil(error.msBeforeNext / 1000),
        });
      }
      throw error;
    }
  }

  async reset(key: string): Promise<void> {
    await this.limiter.delete(key);
  }
}
