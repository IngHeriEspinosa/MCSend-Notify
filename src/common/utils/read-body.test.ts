import { describe, expect, it } from 'vitest';
import { isBodyTooLargeError, readBodyText, readJsonBody } from './read-body';

/** Petición con cuerpo en streaming y sin Content-Length (como una chunked). */
function chunkedRequest(chunks: string[]): { request: Request; pulled: () => number } {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
  });
  const request = new Request('http://localhost/api', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit);
  return { request, pulled: () => index };
}

describe('readBodyText', () => {
  it('lee cuerpos dentro del límite y JSON válido', async () => {
    expect(await readBodyText(new Request('http://x', { method: 'POST', body: 'hola' }), 10)).toBe(
      'hola',
    );
    expect(
      await readJsonBody(new Request('http://x', { method: 'POST', body: '{"a":1}' }), 100),
    ).toEqual({ a: 1 });
  });

  it('rechaza por Content-Length sin leer el cuerpo', async () => {
    const request = new Request('http://x', {
      method: 'POST',
      body: 'x'.repeat(50),
      headers: { 'content-length': '50' },
    });
    await expect(readBodyText(request, 10)).rejects.toSatisfy(isBodyTooLargeError);
  });

  it('sin Content-Length (chunked) aborta en cuanto supera el límite', async () => {
    const { request, pulled } = chunkedRequest(Array.from({ length: 1000 }, () => 'x'.repeat(100)));
    await expect(readBodyText(request, 1_000)).rejects.toSatisfy(isBodyTooLargeError);
    // No se consume el resto del stream.
    expect(pulled()).toBeLessThan(20);
  });

  it('un JSON mal formado lanza SyntaxError', async () => {
    await expect(
      readJsonBody(new Request('http://x', { method: 'POST', body: '{no' }), 100),
    ).rejects.toBeInstanceOf(SyntaxError);
  });
});
