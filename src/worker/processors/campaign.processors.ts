/**
 * Procesadores de campañas: despacho, envío de entregas, eventos de proveedores, correo del
 * sistema y ejecuciones de automatizaciones. Validan cada job con Zod y trabajan con un contexto
 * de sistema del tenant.
 *
 * Envío con límite alcanzado: el job se mueve a "delayed" sin consumir un intento
 * (`moveToDelayed` + `DelayedError`), de modo que los límites no agotan los reintentos.
 */
import { DelayedError, type Job } from 'bullmq';
import type { SendOutcome } from '@/core/campaigns/use-cases/dispatch.use-cases';
import { systemMailMessageSchema, type SystemMailMessage } from '@/core/identity/system-mail';
import { systemContext, type TenantContext } from '@/core/shared/tenant-context';
import { runWithTraceId } from '@/infrastructure/observability/trace-context';
import {
  AUTOMATION_RUN_ATTEMPTS,
  automationRunJobSchema,
  campaignDispatchJobSchema,
  EMAIL_SEND_ATTEMPTS,
  emailSendJobSchema,
  providerEventJobSchema,
} from '@/infrastructure/queue/jobs';

export function createCampaignDispatchProcessor(deps: {
  dispatch: { execute(context: TenantContext, campaignId: string, version: number): Promise<void> };
}) {
  return async function processCampaignDispatch(job: Pick<Job, 'data' | 'id'>): Promise<void> {
    const data = campaignDispatchJobSchema.parse(job.data);
    const context = systemContext(data.tenantId, data.tenantSlug, 'campaign-dispatch');
    await runWithTraceId(data.traceId ?? `job-${job.id ?? data.campaignId}`, () =>
      deps.dispatch.execute(context, data.campaignId, data.version),
    );
  };
}

export function createEmailSendProcessor(deps: {
  send: {
    execute(
      context: TenantContext,
      deliveryId: string,
      options: { finalAttempt: boolean },
    ): Promise<SendOutcome>;
  };
  now?: () => number;
}) {
  return async function processEmailSend(
    job: Pick<Job, 'data' | 'id' | 'attemptsMade' | 'opts' | 'moveToDelayed'>,
    token?: string,
  ): Promise<void> {
    const data = emailSendJobSchema.parse(job.data);
    const context = systemContext(data.tenantId, data.tenantSlug, 'email-send');
    const attempts = job.opts.attempts ?? EMAIL_SEND_ATTEMPTS;
    const outcome = await runWithTraceId(`delivery-${data.deliveryId}`, () =>
      deps.send.execute(context, data.deliveryId, {
        finalAttempt: job.attemptsMade + 1 >= attempts,
      }),
    );
    if (outcome.type === 'delay') {
      await job.moveToDelayed((deps.now ?? Date.now)() + outcome.delayMs, token);
      throw new DelayedError();
    }
  };
}

export function createProviderEventProcessor(deps: {
  apply: { execute(context: TenantContext, eventId: string): Promise<void> };
}) {
  return async function processProviderEvent(job: Pick<Job, 'data'>): Promise<void> {
    const data = providerEventJobSchema.parse(job.data);
    await deps.apply.execute(systemContext(data.tenantId, '', 'provider-event'), data.eventId);
  };
}

export function createSystemMailProcessor(deps: {
  mailer: { send(message: SystemMailMessage): Promise<void> };
}) {
  return async function processSystemMail(job: Pick<Job, 'data'>): Promise<void> {
    await deps.mailer.send(systemMailMessageSchema.parse(job.data));
  };
}

export function createAutomationRunProcessor(deps: {
  run: {
    execute(
      context: TenantContext,
      automationId: string,
      idempotencyKey: string,
      options: { trigger: 'schedule' | 'manual'; finalAttempt: boolean },
    ): Promise<unknown>;
  };
}) {
  return async function processAutomationRun(
    job: Pick<Job, 'data' | 'id' | 'attemptsMade' | 'opts'>,
  ): Promise<void> {
    const data = automationRunJobSchema.parse(job.data);
    const context = systemContext(data.tenantId, data.tenantSlug, 'automation-run');
    // Las ejecuciones programadas usan el id del job (único por fecha de disparo).
    const idempotencyKey = data.idempotencyKey ?? `schedule-${job.id ?? 'unknown'}`;
    const attempts = job.opts.attempts ?? AUTOMATION_RUN_ATTEMPTS;
    await runWithTraceId(`automation-${data.automationId}`, () =>
      deps.run.execute(context, data.automationId, idempotencyKey, {
        trigger: data.trigger,
        finalAttempt: job.attemptsMade + 1 >= attempts,
      }),
    );
  };
}
