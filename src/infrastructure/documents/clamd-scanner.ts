/**
 * Antivirus con ClamAV (clamd) por TCP, comando `INSTREAM`: el archivo se envía en trozos
 * `[longitud uint32 big-endian][datos]` terminados con una longitud 0, y clamd responde
 * `stream: OK` o `stream: <firma> FOUND`.
 *
 * Cualquier otro resultado (sin conexión, tiempo agotado, límite de tamaño de clamd) se trata
 * como `SCAN_UNAVAILABLE`: el documento no se marca como limpio y la cola reintenta.
 */
import { connect } from 'node:net';
import { DocumentProcessingError } from '@/core/documents/document';
import type { MalwareScanner, ScanResult } from '@/core/documents/ports';

const CHUNK_SIZE = 64 * 1024;
const MAX_REPLY_BYTES = 4096;

export class ClamdScanner implements MalwareScanner {
  constructor(private readonly options: { host: string; port: number; timeoutMs?: number }) {}

  async scan(bytes: Uint8Array): Promise<ScanResult> {
    const reply = await this.instream(bytes);
    const match = /^stream: (.+?)( FOUND| OK)?$/.exec(reply.replace(/\0/g, '').trim());
    if (match?.[2] === ' OK' || match?.[1] === 'OK') return { infected: false };
    if (match?.[2] === ' FOUND' && match[1]) return { infected: true, signature: match[1] };
    throw new DocumentProcessingError(
      'SCAN_UNAVAILABLE',
      `Respuesta de clamd: ${reply.slice(0, 200)}`,
    );
  }

  private instream(bytes: Uint8Array): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.options.host, port: this.options.port });
      const chunks: Buffer[] = [];
      let size = 0;
      const fail = (error: Error) => {
        socket.destroy();
        reject(
          new DocumentProcessingError('SCAN_UNAVAILABLE', 'ClamAV no disponible', { cause: error }),
        );
      };
      socket.setTimeout(this.options.timeoutMs ?? 60_000, () => fail(new Error('Tiempo agotado')));
      socket.on('error', fail);
      socket.on('data', (data: Buffer) => {
        size += data.length;
        if (size > MAX_REPLY_BYTES) return fail(new Error('Respuesta demasiado larga'));
        chunks.push(data);
      });
      socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
          const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    });
  }
}
