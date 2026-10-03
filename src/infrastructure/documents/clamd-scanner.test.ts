import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClamdScanner } from './clamd-scanner';

/** clamd simulado: reconstruye el archivo del protocolo INSTREAM y responde según su contenido. */
let server: Server;
let port: number;
const received: Buffer[] = [];

function parseInstream(data: Buffer): Buffer | null {
  const command = 'zINSTREAM\0';
  if (data.subarray(0, command.length).toString() !== command) return null;
  const parts: Buffer[] = [];
  let offset = command.length;
  while (offset + 4 <= data.length) {
    const length = data.readUInt32BE(offset);
    offset += 4;
    if (length === 0) return Buffer.concat(parts);
    parts.push(data.subarray(offset, offset + length));
    offset += length;
  }
  return null;
}

beforeAll(async () => {
  server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const file = parseInstream(Buffer.concat(chunks));
      if (!file) return;
      received.push(file);
      const text = file.toString();
      if (text.includes('BIG')) socket.end('INSTREAM size limit exceeded. ERROR\0');
      else if (text.includes('EICAR')) socket.end('stream: Eicar-Test-Signature FOUND\0');
      else socket.end('stream: OK\0');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('ClamdScanner (INSTREAM)', () => {
  it('envía el archivo por trozos y lo reconstruye íntegro', async () => {
    const content = Buffer.alloc(200_000, 7);
    const result = await new ClamdScanner({ host: '127.0.0.1', port }).scan(content);
    expect(result).toEqual({ infected: false });
    expect(received.at(-1)?.equals(content)).toBe(true);
  });

  it('informa de la firma detectada', async () => {
    const result = await new ClamdScanner({ host: '127.0.0.1', port }).scan(
      Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'),
    );
    expect(result).toEqual({ infected: true, signature: 'Eicar-Test-Signature' });
  });

  it('un error de clamd o sin conexión es SCAN_UNAVAILABLE (nunca se da por limpio)', async () => {
    await expect(
      new ClamdScanner({ host: '127.0.0.1', port }).scan(Buffer.from('BIG')),
    ).rejects.toMatchObject({ code: 'SCAN_UNAVAILABLE' });
    await expect(
      new ClamdScanner({ host: '127.0.0.1', port: 1, timeoutMs: 2000 }).scan(Buffer.from('x')),
    ).rejects.toMatchObject({ code: 'SCAN_UNAVAILABLE' });
  });
});
