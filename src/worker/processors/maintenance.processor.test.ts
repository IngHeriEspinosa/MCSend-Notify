import { describe, expect, it, vi } from 'vitest';
import { MAINTENANCE_JOBS } from '@/infrastructure/queue/queue-names';
import { createMaintenanceProcessor, UnknownMaintenanceJobError } from './maintenance.processor';

describe('createMaintenanceProcessor', () => {
  it('registra el latido en el job heartbeat', async () => {
    const heartbeat = { beat: vi.fn().mockResolvedValue(undefined) };

    await createMaintenanceProcessor(heartbeat)({ name: MAINTENANCE_JOBS.heartbeat });

    expect(heartbeat.beat).toHaveBeenCalledOnce();
  });

  it('rechaza jobs desconocidos para que acaben en fallidos y no se ignoren', async () => {
    const processor = createMaintenanceProcessor({ beat: vi.fn() });

    await expect(processor({ name: 'desconocido' })).rejects.toBeInstanceOf(
      UnknownMaintenanceJobError,
    );
  });
});
