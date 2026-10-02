import { describe, expect, it } from 'vitest';
import {
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_MAX_AGE_MS,
  WorkerHeartbeat,
  workerHeartbeatHealthCheck,
  type HeartbeatRedis,
} from './worker-heartbeat';

function fakeRedis(): HeartbeatRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    set: async (key, value) => {
      store.set(key, value);
      return 'OK';
    },
    get: async (key) => store.get(key) ?? null,
  };
}

describe('WorkerHeartbeat', () => {
  it('registra el latido y calcula su antigüedad', async () => {
    const redis = fakeRedis();
    const heartbeat = new WorkerHeartbeat(redis);

    await heartbeat.beat(new Date('2026-10-02T12:00:00Z'));

    expect(redis.store.get(WORKER_HEARTBEAT_KEY)).toBeDefined();
    expect(await heartbeat.ageMs(new Date('2026-10-02T12:00:30Z'))).toBe(30_000);
  });

  it('devuelve null si nunca hubo latido', async () => {
    expect(await new WorkerHeartbeat(fakeRedis()).ageMs()).toBeNull();
  });
});

describe('workerHeartbeatHealthCheck', () => {
  const signal = new AbortController().signal;

  it('pasa con un latido reciente y no es crítica', async () => {
    const heartbeat = new WorkerHeartbeat(fakeRedis());
    await heartbeat.beat();
    const check = workerHeartbeatHealthCheck(heartbeat);

    expect(check.critical).toBe(false);
    await expect(check.check(signal)).resolves.toBeUndefined();
  });

  it('falla si el último latido es demasiado antiguo', async () => {
    const heartbeat = new WorkerHeartbeat(fakeRedis());
    await heartbeat.beat(new Date(Date.now() - WORKER_HEARTBEAT_MAX_AGE_MS - 1000));

    await expect(workerHeartbeatHealthCheck(heartbeat).check(signal)).rejects.toThrow(/latido/);
  });
});
