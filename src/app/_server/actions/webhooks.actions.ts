'use server';

/** Server Actions de webhooks salientes (permiso `webhook:manage`, validado en el caso de uso). */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import { webhookEndpointInputSchema } from '@/core/webhooks/webhook';
import { useCases } from '@/infrastructure/use-case-factory';

const idSchema = z.object({ id: z.uuid() });

export const createWebhookAction = tenantAction(
  webhookEndpointInputSchema,
  async (input, context) => {
    const { endpoint, secret } = await useCases.webhooks().create(context, input);
    return { id: endpoint.id, secret };
  },
);

export const updateWebhookAction = tenantAction(
  z.object({ id: z.uuid(), endpoint: webhookEndpointInputSchema }),
  ({ id, endpoint }, context) => useCases.webhooks().update(context, id, endpoint),
);

export const rotateWebhookSecretAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.webhooks().rotateSecret(context, id),
);

export const deleteWebhookAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.webhooks().delete(context, id),
);

export const sendWebhookTestAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.webhooks().sendTest(context, id),
);

export const listWebhookDeliveriesAction = tenantAction(
  idSchema,
  ({ id }, context) => useCases.webhooks().deliveries(context, id),
  { refresh: false },
);
