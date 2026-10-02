/**
 * Colas de trabajos: nombres, contratos de datos (Zod) y productores.
 * El worker valida cada job con el mismo esquema antes de procesarlo.
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { ContactImportQueue } from '@/core/contacts/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { currentTraceId } from '../observability/trace-context';
import { QUEUE_NAMES } from './queue-names';

export const contactImportJobSchema = z.object({
  tenantId: z.uuid(),
  tenantSlug: z.string().min(1),
  importId: z.uuid(),
  traceId: z.string().optional(),
});

export type ContactImportJob = z.infer<typeof contactImportJobSchema>;

export class BullContactImportQueue implements ContactImportQueue {
  private readonly queue: Queue<ContactImportJob>;

  constructor(connection: Redis) {
    this.queue = new Queue<ContactImportJob>(QUEUE_NAMES.contactImport, { connection });
  }

  async enqueue(context: TenantContext, importId: string): Promise<void> {
    await this.queue.add(
      'process',
      {
        tenantId: context.tenantId,
        tenantSlug: context.tenantSlug,
        importId,
        traceId: currentTraceId(),
      },
      {
        jobId: `import-${importId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      },
    );
  }
}
