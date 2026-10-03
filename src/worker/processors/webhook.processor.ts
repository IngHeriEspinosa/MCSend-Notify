/**
 * Procesador de webhooks salientes: entrega un evento firmado a un destino. Si el destino no
 * responde 2xx, el caso de uso lanza `WebhookRetryError` y BullMQ reintenta con backoff; en el
 * último intento la entrega queda FAILED y cuenta para la desactivación automática del destino.
 */
import type { Job } from 'bullmq';
import { systemContext, type TenantContext } from '@/core/shared/tenant-context';
import { WEBHOOK_DELIVERY_ATTEMPTS } from '@/core/webhooks/webhooks.use-cases';
import { outboundWebhookJobSchema } from '@/infrastructure/queue/jobs';

export function createOutboundWebhookProcessor(deps: {
  deliver: {
    execute(
      context: TenantContext,
      deliveryId: string,
      options: { attempt: number; finalAttempt: boolean },
    ): Promise<void>;
  };
}) {
  return async function processOutboundWebhook(
    job: Pick<Job, 'data' | 'attemptsMade' | 'opts'>,
  ): Promise<void> {
    const data = outboundWebhookJobSchema.parse(job.data);
    const context = systemContext(data.tenantId, data.tenantSlug, 'outbound-webhook');
    const attempt = job.attemptsMade + 1;
    await deps.deliver.execute(context, data.deliveryId, {
      attempt,
      finalAttempt: attempt >= (job.opts.attempts ?? WEBHOOK_DELIVERY_ATTEMPTS),
    });
  };
}
