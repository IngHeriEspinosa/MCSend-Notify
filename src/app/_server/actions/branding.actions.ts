'use server';

/** Server Actions de la identidad visual de los correos. */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import { updateBrandingSchema } from '@/core/tenants/branding';
import { useCases } from '@/infrastructure/use-case-factory';

export const updateBrandingAction = tenantAction(updateBrandingSchema, async (input, context) => {
  await useCases.branding().update(context, input);
});

export const removeLogoAction = tenantAction(z.object({}), (_input, context) =>
  useCases.branding().removeLogo(context),
);
