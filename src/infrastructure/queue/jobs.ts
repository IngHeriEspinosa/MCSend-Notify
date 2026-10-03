/**
 * Colas de trabajos: nombres, contratos de datos (Zod) y productores.
 * El worker valida cada job con el mismo esquema antes de procesarlo.
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { AutomationRef, AutomationScheduler } from '@/core/automations/ports';
import { cronFor } from '@/core/automations/automation';
import type { CampaignQueue } from '@/core/campaigns/ports';
import type { ProviderEventQueue } from '@/core/campaigns/use-cases/provider-events.use-cases';
import type { ContactImportQueue } from '@/core/contacts/ports';
import type { SystemMailMessage, SystemMailQueue } from '@/core/identity/system-mail';
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

// ----------------------------------------------------------------------------
// Campañas: despacho y envío
// ----------------------------------------------------------------------------

export const campaignDispatchJobSchema = z.object({
  tenantId: z.uuid(),
  tenantSlug: z.string(),
  campaignId: z.uuid(),
  version: z.number().int().min(1),
  traceId: z.string().optional(),
});
export type CampaignDispatchJob = z.infer<typeof campaignDispatchJobSchema>;

export const emailSendJobSchema = z.object({
  tenantId: z.uuid(),
  tenantSlug: z.string(),
  deliveryId: z.uuid(),
});
export type EmailSendJob = z.infer<typeof emailSendJobSchema>;

/** Reintentos de un envío transitorio: 30 s, 1, 2, 4, 8 y 16 min (backoff exponencial). */
export const EMAIL_SEND_ATTEMPTS = 6;

export class BullCampaignQueue implements CampaignQueue {
  private readonly dispatch: Queue<CampaignDispatchJob>;
  private readonly send: Queue<EmailSendJob>;

  constructor(connection: Redis) {
    this.dispatch = new Queue<CampaignDispatchJob>(QUEUE_NAMES.campaignDispatch, { connection });
    this.send = new Queue<EmailSendJob>(QUEUE_NAMES.emailSend, { connection });
  }

  async enqueueDispatch(
    context: TenantContext,
    campaignId: string,
    version: number,
    delayMs: number,
  ) {
    await this.dispatch.add(
      'dispatch',
      {
        tenantId: context.tenantId,
        tenantSlug: context.tenantSlug,
        campaignId,
        version,
        traceId: currentTraceId(),
      },
      {
        // Idempotente por versión: reprogramar crea otra versión y el job anterior queda obsoleto.
        jobId: ['dispatch', campaignId, String(version)].join('-'),
        delay: delayMs,
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: 200,
      },
    );
  }

  async enqueueSends(context: TenantContext, deliveryIds: readonly string[]) {
    if (deliveryIds.length === 0) return;
    await this.send.addBulk(
      deliveryIds.map((deliveryId) => ({
        name: 'send',
        data: { tenantId: context.tenantId, tenantSlug: context.tenantSlug, deliveryId },
        opts: {
          // Un job por entrega: reencolar (reanudar, recuperar) nunca duplica un job vivo.
          jobId: 'delivery-' + deliveryId,
          attempts: EMAIL_SEND_ATTEMPTS,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      })),
    );
  }

  async close(): Promise<void> {
    await Promise.all([this.dispatch.close(), this.send.close()]);
  }
}

export const providerEventJobSchema = z.object({
  tenantId: z.uuid(),
  eventId: z.uuid(),
});
export type ProviderEventJob = z.infer<typeof providerEventJobSchema>;

export class BullProviderEventQueue implements ProviderEventQueue {
  private readonly queue: Queue<ProviderEventJob>;

  constructor(connection: Redis) {
    this.queue = new Queue<ProviderEventJob>(QUEUE_NAMES.providerEvents, { connection });
  }

  async enqueue(context: TenantContext, eventId: string) {
    await this.queue.add(
      'apply',
      { tenantId: context.tenantId, eventId },
      {
        jobId: 'event-' + eventId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );
  }
}

export class BullSystemMailQueue implements SystemMailQueue {
  private readonly queue: Queue<SystemMailMessage>;

  constructor(connection: Redis) {
    this.queue = new Queue<SystemMailMessage>(QUEUE_NAMES.systemMail, { connection });
  }

  async enqueue(message: SystemMailMessage) {
    await this.queue.add('send', message, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: true,
      removeOnFail: 200,
    });
  }
}

export const automationRunJobSchema = z.object({
  tenantId: z.uuid(),
  tenantSlug: z.string().min(1),
  automationId: z.uuid(),
  trigger: z.enum(['schedule', 'manual']),
  /** Solo en ejecuciones manuales; las programadas usan el id del job (único por fecha). */
  idempotencyKey: z.string().max(120).optional(),
});
export type AutomationRunJob = z.infer<typeof automationRunJobSchema>;

/** Reintentos de una ejecución con fallo transitorio (IA no disponible): 1, 2 y 4 min. */
export const AUTOMATION_RUN_ATTEMPTS = 3;

const AUTOMATION_JOB_OPTIONS = {
  attempts: AUTOMATION_RUN_ATTEMPTS,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: true,
  removeOnFail: 200,
} as const;

function schedulerId(automationId: string): string {
  return 'automation-' + automationId;
}

/** Programación de automatizaciones con BullMQ Job Schedulers (cron + zona horaria). */
export class BullAutomationScheduler implements AutomationScheduler {
  private readonly queue: Queue<AutomationRunJob>;

  constructor(connection: Redis) {
    this.queue = new Queue<AutomationRunJob>(QUEUE_NAMES.automationRun, { connection });
  }

  async upsert(ref: AutomationRef): Promise<void> {
    await this.queue.upsertJobScheduler(
      schedulerId(ref.id),
      { pattern: cronFor(ref.schedule), tz: ref.timezone },
      {
        name: 'run',
        data: {
          tenantId: ref.tenantId,
          tenantSlug: ref.tenantSlug,
          automationId: ref.id,
          trigger: 'schedule',
        },
        opts: AUTOMATION_JOB_OPTIONS,
      },
    );
  }

  async remove(automationId: string): Promise<void> {
    await this.queue.removeJobScheduler(schedulerId(automationId));
  }

  async enqueueRun(
    context: TenantContext,
    automationId: string,
    idempotencyKey: string,
    trigger: 'schedule' | 'manual',
  ): Promise<void> {
    await this.queue.add(
      'run',
      {
        tenantId: context.tenantId,
        tenantSlug: context.tenantSlug,
        automationId,
        trigger,
        idempotencyKey,
      },
      { ...AUTOMATION_JOB_OPTIONS, jobId: ['automation', automationId, idempotencyKey].join('-') },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
