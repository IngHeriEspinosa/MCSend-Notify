import { DelayedError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { createAutomationRunProcessor, createEmailSendProcessor } from './campaign.processors';

const DATA = {
  tenantId: '11111111-1111-7111-8111-111111111111',
  tenantSlug: 'mcsupport',
  deliveryId: '0199a8f0-0000-7000-8000-000000000001',
};

describe('createEmailSendProcessor', () => {
  it('con límite alcanzado mueve el job a "delayed" sin consumir un intento', async () => {
    const delayed: Array<number | undefined> = [];
    const processor = createEmailSendProcessor({
      send: { execute: async () => ({ type: 'delay', delayMs: 500 }) },
      now: () => 1_000,
    });
    await expect(
      processor(
        {
          id: 'job-1',
          data: DATA,
          attemptsMade: 0,
          opts: { attempts: 6 },
          moveToDelayed: async (timestamp: number) => {
            delayed.push(timestamp);
          },
        },
        'token',
      ),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(delayed).toEqual([1_500]);
  });

  it('indica el último intento al caso de uso', async () => {
    const flags: boolean[] = [];
    const processor = createEmailSendProcessor({
      send: {
        execute: async (_context, _id, options) => {
          flags.push(options.finalAttempt);
          return { type: 'done' };
        },
      },
    });
    const job = { id: 'j', data: DATA, opts: { attempts: 3 }, moveToDelayed: async () => {} };
    await processor({ ...job, attemptsMade: 0 });
    await processor({ ...job, attemptsMade: 2 });
    expect(flags).toEqual([false, true]);
  });
});

describe('createAutomationRunProcessor', () => {
  it('usa el id del job como clave de las ejecuciones programadas e indica el último intento', async () => {
    const calls: Array<{ key: string; finalAttempt: boolean; trigger: string }> = [];
    const processor = createAutomationRunProcessor({
      run: {
        execute: async (_context, _id, key, options) => {
          calls.push({ key, finalAttempt: options.finalAttempt, trigger: options.trigger });
          return null;
        },
      },
    });
    const data = {
      tenantId: DATA.tenantId,
      tenantSlug: DATA.tenantSlug,
      automationId: '0199a8f0-0000-7000-8000-000000000009',
    };
    await processor({
      id: 'repeat:automation-x:1759737600000',
      data: { ...data, trigger: 'schedule' },
      attemptsMade: 0,
      opts: { attempts: 3 },
    });
    await processor({
      id: 'automation-manual',
      data: { ...data, trigger: 'manual', idempotencyKey: 'manual-1' },
      attemptsMade: 2,
      opts: { attempts: 3 },
    });
    expect(calls).toEqual([
      {
        key: 'schedule-repeat:automation-x:1759737600000',
        finalAttempt: false,
        trigger: 'schedule',
      },
      { key: 'manual-1', finalAttempt: true, trigger: 'manual' },
    ]);
  });
});
