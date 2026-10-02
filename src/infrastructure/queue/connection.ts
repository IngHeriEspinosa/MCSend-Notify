/**
 * Conexiones a Redis.
 * - `worker`: para Workers de BullMQ; requiere `maxRetriesPerRequest: null` (conexiones bloqueantes).
 * - `client`: para la app (encolar, contadores, latidos); acota los reintentos por comando para
 *   fallar pronto si Redis no responde. La cola offline se mantiene activa para que los comandos
 *   emitidos mientras se establece la conexión inicial no fallen.
 */
import { Redis } from 'ioredis';

export type RedisConnectionPurpose = 'worker' | 'client';

export function createRedisConnection(url: string, purpose: RedisConnectionPurpose): Redis {
  return new Redis(url, {
    connectionName: `mcsn-${purpose}`,
    maxRetriesPerRequest: purpose === 'worker' ? null : 3,
    connectTimeout: 5000,
  });
}
