/**
 * Procesador de documentos: valida el job, restaura el traceId y ejecuta el caso de uso con un
 * contexto de sistema. En el último intento un error deja el documento en FAILED.
 */
import type { Job } from 'bullmq';
import { systemContext, type TenantContext } from '@/core/shared/tenant-context';
import { runWithTraceId } from '@/infrastructure/observability/trace-context';
import { DOCUMENT_PROCESS_ATTEMPTS, documentProcessJobSchema } from '@/infrastructure/queue/jobs';

export interface DocumentProcessorDeps {
  processDocument: {
    execute(
      context: TenantContext,
      documentId: string,
      options: { finalAttempt: boolean },
    ): Promise<void>;
  };
}

export function createDocumentProcessor(deps: DocumentProcessorDeps) {
  return async function processDocumentJob(
    job: Pick<Job, 'data' | 'id' | 'attemptsMade' | 'opts'>,
  ): Promise<void> {
    const data = documentProcessJobSchema.parse(job.data);
    const context = systemContext(data.tenantId, data.tenantSlug, 'document-process');
    const attempts = job.opts.attempts ?? DOCUMENT_PROCESS_ATTEMPTS;
    await runWithTraceId(data.traceId ?? `job-${job.id ?? data.documentId}`, () =>
      deps.processDocument.execute(context, data.documentId, {
        finalAttempt: job.attemptsMade + 1 >= attempts,
      }),
    );
  };
}
