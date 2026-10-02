import { describe, expect, it } from 'vitest';
import { createDocumentProcessor } from './document-process.processor';

const DATA = {
  tenantId: '11111111-1111-7111-8111-111111111111',
  tenantSlug: 'mcsupport',
  documentId: '0199a8f0-0000-7000-8000-000000000001',
};

describe('createDocumentProcessor', () => {
  it('marca el último intento como final y usa un contexto de sistema', async () => {
    const calls: Array<{ documentId: string; finalAttempt: boolean; actor: string }> = [];
    const processor = createDocumentProcessor({
      processDocument: {
        execute: async (context, documentId, options) => {
          calls.push({ documentId, finalAttempt: options.finalAttempt, actor: context.actor.type });
        },
      },
    });

    await processor({ id: '1', data: DATA, attemptsMade: 0, opts: { attempts: 3 } });
    await processor({ id: '1', data: DATA, attemptsMade: 2, opts: { attempts: 3 } });

    expect(calls).toEqual([
      { documentId: DATA.documentId, finalAttempt: false, actor: 'system' },
      { documentId: DATA.documentId, finalAttempt: true, actor: 'system' },
    ]);
  });

  it('rechaza jobs con datos inválidos', async () => {
    const processor = createDocumentProcessor({ processDocument: { execute: async () => {} } });
    await expect(
      processor({ id: '1', data: { ...DATA, tenantId: 'x' }, attemptsMade: 0, opts: {} }),
    ).rejects.toThrow();
  });
});
