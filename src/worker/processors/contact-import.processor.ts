/**
 * Procesador de importaciones de contactos. Valida el contrato del job con Zod, restaura el
 * traceId de la petición original y ejecuta el caso de uso con un contexto de sistema.
 */
import type { Job } from 'bullmq';
import { systemContext } from '@/core/shared/tenant-context';
import { runWithTraceId } from '@/infrastructure/observability/trace-context';
import { contactImportJobSchema } from '@/infrastructure/queue/jobs';

export interface ContactImportProcessorDeps {
  processImport: {
    execute(context: ReturnType<typeof systemContext>, importId: string): Promise<void>;
  };
}

export function createContactImportProcessor(deps: ContactImportProcessorDeps) {
  return async function processContactImportJob(job: Pick<Job, 'data' | 'id'>): Promise<void> {
    const data = contactImportJobSchema.parse(job.data);
    const context = systemContext(data.tenantId, data.tenantSlug, 'contact-import');
    await runWithTraceId(data.traceId ?? `job-${job.id ?? data.importId}`, () =>
      deps.processImport.execute(context, data.importId),
    );
  };
}
