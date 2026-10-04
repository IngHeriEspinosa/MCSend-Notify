/**
 * Lectura del cuerpo de una petición con un límite real de tamaño.
 *
 * Comprobar solo `Content-Length` no basta: una petición `Transfer-Encoding: chunked` no la
 * envía y `request.text()` leería el cuerpo entero en memoria. Aquí se lee el stream por trozos
 * y se aborta en cuanto se supera el límite (OWASP A04/A05, denegación de servicio).
 */

const BODY_TOO_LARGE_BRAND = Symbol.for('mc-send-notify.BodyTooLargeError');

export class BodyTooLargeError extends Error {
  readonly [BODY_TOO_LARGE_BRAND] = true;

  constructor(readonly maxBytes: number) {
    super(`El cuerpo supera ${maxBytes} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

export function isBodyTooLargeError(error: unknown): error is BodyTooLargeError {
  return typeof error === 'object' && error !== null && BODY_TOO_LARGE_BRAND in error;
}

/** Devuelve el cuerpo como texto UTF-8 o lanza `BodyTooLargeError` si supera `maxBytes`. */
export async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  if (Number(request.headers.get('content-length') ?? '0') > maxBytes) {
    throw new BodyTooLargeError(maxBytes);
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Como `readBodyText`, pero interpreta JSON (lanza `SyntaxError` si no es válido). */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readBodyText(request, maxBytes)) as unknown;
}
