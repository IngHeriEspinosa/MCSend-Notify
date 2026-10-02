import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';
import { runWithTraceId } from './trace-context';

function captureStream() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('incluye el servicio en cada registro', () => {
    const { lines, stream } = captureStream();
    createLogger({ level: 'info', service: 'worker', baseStream: stream }).info('hola');

    expect(lines[0]).toMatchObject({ service: 'worker', msg: 'hola' });
  });

  it('redacta credenciales y cabeceras sensibles', () => {
    const { lines, stream } = captureStream();
    const logger = createLogger({ level: 'info', service: 'web', baseStream: stream });

    logger.info(
      {
        password: 'p4ss',
        config: { apiKey: 'sk-123', credentials: { user: 'u' } },
        headers: { authorization: 'Bearer abc', cookie: 'session=1' },
      },
      'configuración',
    );

    const serialized = JSON.stringify(lines[0]);
    expect(serialized).not.toMatch(/p4ss|sk-123|Bearer abc|session=1/);
    expect(lines[0]).toMatchObject({ password: '[REDACTED]' });
  });

  it('añade el traceId del contexto activo', () => {
    const { lines, stream } = captureStream();
    const logger = createLogger({ level: 'info', service: 'web', baseStream: stream });

    runWithTraceId('trace-abc-123', () => logger.info('dentro'));
    logger.info('fuera');

    expect(lines[0]).toMatchObject({ traceId: 'trace-abc-123' });
    expect(lines[1]).not.toHaveProperty('traceId');
  });

  it('respeta el nivel mínimo de cada destino adicional', () => {
    const base = captureStream();
    const extra = captureStream();
    const logger = createLogger({
      level: 'info',
      service: 'web',
      baseStream: base.stream,
      extraStreams: [{ level: 'warn', stream: extra.stream }],
    });

    logger.info('informativo');
    logger.warn('aviso');

    expect(base.lines).toHaveLength(2);
    expect(extra.lines.map((line) => line.msg)).toEqual(['aviso']);
  });
});
