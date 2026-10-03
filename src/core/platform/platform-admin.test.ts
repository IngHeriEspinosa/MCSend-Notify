import { describe, expect, it } from 'vitest';
import { FakeClock, RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import type { SessionUser } from '@/core/tenants/use-cases';
import {
  ManageQueuesUseCase,
  PlatformAiUsageUseCase,
  type QueueAdmin,
  type TenantAiUsageRow,
} from './platform-admin';

const admin: SessionUser = {
  id: 'admin-1',
  platformRole: 'SUPER_ADMIN',
};
const user: SessionUser = { ...admin, id: 'user-1', platformRole: 'USER' };

function row(overrides: Partial<TenantAiUsageRow>): TenantAiUsageRow {
  return {
    tenantId: 't',
    tenantSlug: 't',
    tenantName: 'T',
    source: null,
    monthlyBudgetUsd: null,
    calls: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    costMicros: 0,
    ...overrides,
  };
}

describe('ManageQueuesUseCase', () => {
  const failedJobs = new Set(['job-1']);
  const queues: QueueAdmin = {
    overview: async () => [],
    failed: async () => [],
    retry: async (_queue, jobId) => failedJobs.delete(jobId),
    remove: async () => false,
  };

  it('solo un SUPER_ADMIN ve y opera las colas; las acciones se auditan', async () => {
    const audit = new RecordingAuditLogger();
    const useCase = new ManageQueuesUseCase({ queues, audit });
    await expect(useCase.overview(user)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      useCase.retry(user, { queue: 'email-send', jobId: 'job-1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await useCase.retry(admin, { queue: 'email-send', jobId: 'job-1' });
    await expect(
      useCase.retry(admin, { queue: 'email-send', jobId: 'job-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(useCase.remove(admin, { queue: 'email-send', jobId: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'queue.job_retried',
        entityId: 'job-1',
        metadata: { queue: 'email-send', by: 'admin-1' },
      }),
    ]);
  });
});

describe('PlatformAiUsageUseCase', () => {
  it('consulta el mes natural UTC pedido y separa el coste de la clave de la plataforma', async () => {
    const ranges: Array<[Date, Date]> = [];
    const useCase = new PlatformAiUsageUseCase({
      clock: new FakeClock(new Date('2026-10-03T10:00:00Z')),
      usage: {
        byTenant: async (from, to) => {
          ranges.push([from, to]);
          return [
            row({ tenantId: 'a', tenantName: 'Beta', source: 'OWN', costMicros: 3_000_000 }),
            row({ tenantId: 'b', tenantName: 'Alfa', source: 'PLATFORM', costMicros: 5_000_000 }),
            row({ tenantId: 'c', tenantName: 'Cero' }),
          ];
        },
      },
    });

    const current = await useCase.month(admin);
    expect(current.month).toBe('2026-10');
    expect(ranges[0]).toEqual([new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z')]);
    expect(current.rows.map((item) => item.tenantName)).toEqual(['Alfa', 'Beta', 'Cero']);
    expect(current.platformCostMicros).toBe(5_000_000);
    expect(current.totalCostMicros).toBe(8_000_000);

    const december = await useCase.month(admin, '2025-12');
    expect(december.month).toBe('2025-12');
    expect(ranges[1]).toEqual([new Date('2025-12-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z')]);
    await expect(useCase.month(user)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
