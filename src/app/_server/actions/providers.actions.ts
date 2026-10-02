'use server';

/** Server Actions de proveedores de correo y remitentes. */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import { providerInputSchema, senderInputSchema } from '@/core/providers/provider-config';
import { useCases } from '@/infrastructure/use-case-factory';

const idSchema = z.object({ id: z.uuid() });

export const createProviderAction = tenantAction(providerInputSchema, async (input, context) => {
  await useCases.providers().create(context, input);
});

export const updateProviderAction = tenantAction(
  z.object({ id: z.uuid(), provider: providerInputSchema }),
  async ({ id, provider }, context) => {
    await useCases.providers().update(context, id, provider);
  },
);

export const verifyProviderAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.providers().verify(context, id),
);

export const deleteProviderAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.providers().delete(context, id),
);

export const createSenderAction = tenantAction(senderInputSchema, async (input, context) => {
  await useCases.senders().create(context, input);
});

export const updateSenderAction = tenantAction(
  z.object({ id: z.uuid(), sender: senderInputSchema }),
  async ({ id, sender }, context) => {
    await useCases.senders().update(context, id, sender);
  },
);

export const checkSenderDnsAction = tenantAction(idSchema, async ({ id }, context) => {
  const sender = await useCases.senders().checkDns(context, id);
  return sender.dnsCheck;
});

export const deleteSenderAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.senders().delete(context, id),
);
