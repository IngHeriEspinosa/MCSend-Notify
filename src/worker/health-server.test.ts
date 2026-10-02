import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isHealthy, startHealthServer, type WorkerStatus } from './health-server';

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function request(status: WorkerStatus, path = '/health') {
  server = await startHealthServer(0, () => status);
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}${path}`);
}

describe('isHealthy', () => {
  it('exige Redis conectado y todos los workers activos', () => {
    expect(isHealthy({ redis: true, workers: { maintenance: true } })).toBe(true);
    expect(isHealthy({ redis: false, workers: { maintenance: true } })).toBe(false);
    expect(isHealthy({ redis: true, workers: { maintenance: false } })).toBe(false);
  });
});

describe('startHealthServer', () => {
  it('responde 200 con el estado cuando el worker está sano', async () => {
    const response = await request({ redis: true, workers: { maintenance: true } });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', workers: { maintenance: true } });
  });

  it('responde 503 cuando el worker está degradado', async () => {
    const response = await request({ redis: false, workers: { maintenance: true } });

    expect(response.status).toBe(503);
  });

  it('responde 404 en otras rutas', async () => {
    const response = await request({ redis: true, workers: {} }, '/otra');

    expect(response.status).toBe(404);
  });
});
