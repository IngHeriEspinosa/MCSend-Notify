import type { MCLogInput } from '@multicomputos-srl/mclog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCLogBatchStream, toMCLogEntry, type LogBatchSender } from './mclog.transport';

function pinoLine(fields: Record<string, unknown>): string {
  return JSON.stringify({ time: Date.UTC(2026, 9, 2, 12), pid: 1, hostname: 'host', ...fields });
}

function fakeSender(): LogBatchSender & { batches: MCLogInput[][] } {
  const batches: MCLogInput[][] = [];
  return {
    batches,
    sendBatch: vi.fn(async (entries: MCLogInput[]) => {
      batches.push(entries);
      return true;
    }),
  };
}

describe('toMCLogEntry', () => {
  it('descarta niveles inferiores a warn y líneas que no son JSON', () => {
    expect(toMCLogEntry(pinoLine({ level: 30, msg: 'info' }))).toBeNull();
    expect(toMCLogEntry('no es json')).toBeNull();
  });

  it('separa mensaje, traza y servicio, y deja el resto en metadata', () => {
    const entry = toMCLogEntry(
      pinoLine({
        level: 40,
        msg: 'Proveedor lento',
        traceId: 'trace-1234',
        service: 'worker',
        campaignId: 'c1',
      }),
    );

    expect(entry).toMatchObject({
      level: 'warn',
      message: 'Proveedor lento',
      traceId: 'trace-1234',
      service: 'worker',
      timestamp: '2026-10-02T12:00:00.000Z',
      metadata: { campaignId: 'c1' },
    });
  });

  it('envía la excepción completa para que MCLog agrupe los errores', () => {
    const entry = toMCLogEntry(
      pinoLine({
        level: 50,
        msg: 'Fallo de envío',
        err: {
          type: 'TypeError',
          message: 'boom',
          stack: 'TypeError: boom\n at x',
          code: 'ECONNRESET',
        },
      }),
    );

    expect(entry?.level).toBe('error');
    expect(entry?.error).toEqual({
      name: 'TypeError',
      message: 'boom',
      stack: 'TypeError: boom\n at x',
      code: 'ECONNRESET',
    });
    expect(entry?.metadata).toBeUndefined();
  });
});

describe('MCLogBatchStream', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('envía el lote al alcanzar el tamaño máximo', async () => {
    const sender = fakeSender();
    const stream = new MCLogBatchStream({ sender, maxBatchSize: 2 });

    stream.write(pinoLine({ level: 40, msg: 'uno' }));
    stream.write(pinoLine({ level: 50, msg: 'dos' }));
    await vi.waitFor(() => expect(sender.batches).toHaveLength(1));

    expect(sender.batches[0]?.map((entry) => entry.message)).toEqual(['uno', 'dos']);
    await stream.close();
  });

  it('envía periódicamente lo acumulado', async () => {
    const sender = fakeSender();
    const stream = new MCLogBatchStream({ sender, flushIntervalMs: 5000 });

    stream.write(pinoLine({ level: 40, msg: 'pendiente' }));
    expect(sender.batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);

    expect(sender.batches).toHaveLength(1);
    await stream.close();
  });

  it('descarta y cuenta las entradas cuando el buffer está lleno', async () => {
    const sender = fakeSender();
    const stream = new MCLogBatchStream({ sender, maxBatchSize: 100, maxBufferSize: 2 });

    for (const msg of ['a', 'b', 'c']) {
      stream.write(pinoLine({ level: 40, msg }));
    }

    expect(stream.droppedCount).toBe(1);
    await stream.close();
    expect(sender.batches[0]).toHaveLength(2);
  });

  it('no propaga los fallos del envío', async () => {
    const sender: LogBatchSender = { sendBatch: vi.fn().mockRejectedValue(new Error('caído')) };
    const stream = new MCLogBatchStream({ sender });

    stream.write(pinoLine({ level: 50, msg: 'error' }));

    await expect(stream.close()).resolves.toBeUndefined();
  });
});
