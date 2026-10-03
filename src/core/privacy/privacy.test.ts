import { describe, expect, it } from 'vitest';
import { FakeClock, RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import { ownerContext } from '@tests/fakes/sending.fakes';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  ApplyRetentionUseCase,
  EraseContactUseCase,
  RETENTION_DAYS,
  type RetentionTarget,
} from './privacy';

describe('ApplyRetentionUseCase', () => {
  it('purga cada tabla con su antigüedad máxima y devuelve las filas borradas', async () => {
    const calls: Array<[RetentionTarget, string]> = [];
    const useCase = new ApplyRetentionUseCase({
      clock: new FakeClock(new Date('2026-10-03T03:30:00Z')),
      retention: {
        purge: async (target, before) => {
          calls.push([target, before.toISOString()]);
          return target === 'webhook_deliveries' ? 7 : 0;
        },
      },
    });

    const result = await useCase.execute();

    expect(calls).toEqual([
      ['delivery_events', '2025-09-02T03:30:00.000Z'],
      ['ai_usage', '2025-09-02T03:30:00.000Z'],
      ['inbound_webhook_events', '2026-07-05T03:30:00.000Z'],
      ['webhook_deliveries', '2026-09-03T03:30:00.000Z'],
    ]);
    expect(result.webhook_deliveries).toBe(7);
    expect(RETENTION_DAYS.delivery_events).toBeGreaterThanOrEqual(395);
  });
});

describe('EraseContactUseCase', () => {
  const erased: string[] = [];
  const eraser = {
    eraseContact: async (_context: TenantContext, contactId: string) => {
      if (contactId !== 'contact-1') return null;
      erased.push(contactId);
      return { deliveries: 3 };
    },
  };

  it('suprime el contacto, audita sin datos personales y exige permiso de borrado', async () => {
    const audit = new RecordingAuditLogger();
    const useCase = new EraseContactUseCase({ eraser, audit });
    const viewer: TenantContext = {
      ...ownerContext,
      actor: { type: 'user', userId: 'v', role: 'VIEWER', isPlatformAdmin: false },
    };

    await expect(useCase.execute(viewer, 'contact-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(useCase.execute(ownerContext, 'otro')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await useCase.execute(ownerContext, 'contact-1')).toEqual({ deliveries: 3 });
    expect(erased).toEqual(['contact-1']);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'contact.erased',
        entityId: 'contact-1',
        metadata: { deliveriesAnonymized: 3 },
      }),
    ]);
  });
});
