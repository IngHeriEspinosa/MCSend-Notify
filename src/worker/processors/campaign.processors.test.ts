import { DelayedError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { createEmailSendProcessor } from './campaign.processors';

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
