import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBlockedAddress, safeFetch } from './safe-fetch';

let main: Server;
let other: Server;
let base: string;
let otherBase: string;
const seenHeaders: IncomingHttpHeaders[] = [];

function listen(server: Server): Promise<string> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    }),
  );
}

beforeAll(async () => {
  other = createServer((request, response) => {
    seenHeaders.push(request.headers);
    response.end('otro origen');
  });
  otherBase = await listen(other);
  main = createServer((request, response) => {
    switch (request.url) {
      case '/page':
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<html><title>Hola</title></html>');
        return;
      case '/gzip':
        response.setHeader('content-type', 'text/plain');
        response.setHeader('content-encoding', 'gzip');
        response.end(gzipSync('x'.repeat(5000)));
        return;
      case '/big':
        response.setHeader('content-type', 'text/plain');
        response.end('x'.repeat(3000));
        return;
      case '/binary':
        response.setHeader('content-type', 'application/octet-stream');
        response.end('MZ');
        return;
      case '/to-metadata':
        response.statusCode = 302;
        response.setHeader('location', 'http://169.254.169.254/latest/meta-data');
        response.end();
        return;
      case '/to-other':
        response.statusCode = 307;
        response.setHeader('location', `${otherBase}/x`);
        response.end();
        return;
      case '/loop':
        response.statusCode = 302;
        response.setHeader('location', '/loop');
        response.end();
        return;
      default:
        response.statusCode = 404;
        response.end();
    }
  });
  base = await listen(main);
});

afterAll(() => {
  main.close();
  other.close();
});

const local = { allowPrivate: true, ports: 'any' as const };

describe('safeFetch (SSRF)', () => {
  it('bloquea hosts privados, puertos no estándar y credenciales en la URL por defecto', async () => {
    await expect(safeFetch(`${base}/page`, { ports: 'any' })).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(safeFetch(`${base}/page`, { allowPrivate: true })).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    await expect(safeFetch('http://user:pass@example.com/')).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
    await expect(safeFetch('file:///etc/passwd')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(safeFetch('http://localhost/')).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('los metadatos de nube se bloquean siempre, también tras una redirección', async () => {
    expect(isBlockedAddress('169.254.169.254', true)).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254', true)).toBe(true);
    await expect(safeFetch(`${base}/to-metadata`, local)).rejects.toMatchObject({
      code: 'BLOCKED',
    });
  });

  it('descarga con límites de tipo, tamaño (también descomprimido) y redirecciones', async () => {
    const page = await safeFetch(`${base}/page`, { ...local, accept: ['text/html'] });
    expect(page.body.toString()).toContain('<title>Hola</title>');
    await expect(
      safeFetch(`${base}/binary`, { ...local, accept: ['text/html'] }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(safeFetch(`${base}/big`, { ...local, maxBytes: 1000 })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    await expect(safeFetch(`${base}/gzip`, { ...local, maxBytes: 1000 })).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    await expect(safeFetch(`${base}/loop`, local)).rejects.toMatchObject({ code: 'REDIRECTS' });
  });

  it('nunca reenvía la clave de API a otro origen en una redirección', async () => {
    const response = await safeFetch(`${base}/to-other`, {
      ...local,
      method: 'POST',
      body: '{}',
      headers: { authorization: 'Bearer sk-secreto', 'content-type': 'application/json' },
    });
    expect(response.body.toString()).toBe('otro origen');
    expect(seenHeaders.at(-1)?.authorization).toBeUndefined();
  });
});
