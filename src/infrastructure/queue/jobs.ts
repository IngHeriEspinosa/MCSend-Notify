/**
 * Colas de trabajos: nombres, contratos de datos (Zod) y productores.
 * El worker valida cada job con el mismo esquema antes de procesarlo.
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { ContactImportQueue } from '@/core/contacts/ports';
import type { DocumentQueue } from '@/core/documents/ports';
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

export const documentProcessJobSchema = z.object({
  tenantId: z.uuid(),
  tenantSlug: z.string(),
  documentId: z.uuid(),
  traceId: z.string().optional(),
});

export type DocumentProcessJob = z.infer<typeof documentProcessJobSchema>;

/** Intentos del procesamiento de documentos (el último deja el documento en FAILED). */
export const DOCUMENT_PROCESS_ATTEMPTS = 3;

export class BullDocumentQueue implements DocumentQueue {
  private readonly queue: Queue<DocumentProcessJob>;

  constructor(connection: Redis) {
    this.queue = new Queue<DocumentProcessJob>(QUEUE_NAMES.documentProcess, { connection });
  }

  async enqueue(context: TenantContext, documentId: string): Promise<void> {
    await this.queue.add(
      'process',
      {
        tenantId: context.tenantId,
        tenantSlug: context.tenantSlug,
        documentId,
        traceId: currentTraceId(),
      },
      {
        // El jobId incluye la marca de tiempo para permitir reintentos manuales tras un fallo.
        jobId: `document-${documentId}-${Date.now()}`,
        attempts: DOCUMENT_PROCESS_ATTEMPTS,
        backoff: { type: 'exponential', delay: 15_000 },
        removeOnComplete: true,
        removeOnFail: 200,
      },
    );
  }

  close(): Promise<void> {
    return this.queue.close();
  }
}
