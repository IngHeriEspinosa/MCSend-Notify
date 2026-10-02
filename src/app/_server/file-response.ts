/**
 * Respuestas de archivo en flujo para route handlers. Cabeceras defensivas comunes:
 * - `X-Content-Type-Options: nosniff` y una CSP `sandbox` sin recursos: aunque un archivo HTML o
 *   PDF se abriera en el navegador, no podría ejecutar scripts en el origen de la app.
 * - `Content-Disposition` con nombre ASCII seguro y variante UTF-8 (RFC 6266).
 */
import 'server-only';
import type { ByteStream } from '@/core/shared/ports';

function toWebStream(source: ByteStream): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export interface FileResponseOptions {
  contentType: string;
  disposition: 'inline' | 'attachment';
  /** Nombre ASCII seguro (ver `safeDownloadName`). */
  fileName?: string;
  /** Nombre original con acentos para `filename*`. */
  utf8FileName?: string;
  cacheControl: string;
  /** `cross-origin` para recursos que cargan los clientes de correo. */
  crossOrigin?: boolean;
}

export function fileResponse(stream: ByteStream, options: FileResponseOptions): Response {
  const disposition = options.fileName
    ? `${options.disposition}; filename="${options.fileName}"${
        options.utf8FileName ? `; filename*=UTF-8''${encodeURIComponent(options.utf8FileName)}` : ''
      }`
    : options.disposition;
  return new Response(toWebStream(stream), {
    headers: {
      'Content-Type': options.contentType,
      'Content-Disposition': disposition,
      'Cache-Control': options.cacheControl,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': options.crossOrigin ? 'cross-origin' : 'same-origin',
    },
  });
}
