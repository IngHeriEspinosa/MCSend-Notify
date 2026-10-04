'use server';

/**
 * Server Actions del dominio de seguimiento propio. Tras cada cambio se refresca el directorio en
 * memoria de este proceso; el worker lo refresca solo en menos de un minuto.
 */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import { getTrackingHostDirectory } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const setTrackingDomainAction = tenantAction(
  z.object({ domain: z.string().max(253) }),
  async ({ domain }, context) => {
    const view = await useCases.trackingDomain().set(context, domain);
    await getTrackingHostDirectory().refresh();
    return view;
  },
);

export const verifyTrackingDomainAction = tenantAction(z.object({}), async (_input, context) => {
  const view = await useCases.trackingDomain().verify(context);
  await getTrackingHostDirectory().refresh();
  return view;
});

export const removeTrackingDomainAction = tenantAction(z.object({}), async (_input, context) => {
  await useCases.trackingDomain().remove(context);
  await getTrackingHostDirectory().refresh();
});
