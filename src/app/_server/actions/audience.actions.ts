'use server';

/** Server Actions de listas y segmentos. */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import { segmentRuleSetSchema } from '@/core/contacts/segments';
import {
  contactListSchema,
  segmentInputSchema,
} from '@/core/contacts/use-cases/audience.use-cases';
import { useCases } from '@/infrastructure/use-case-factory';

export const createListAction = tenantAction(contactListSchema, (input, context) =>
  useCases.lists().create(context, input),
);

export const updateListAction = tenantAction(
  z.object({ id: z.uuid(), list: contactListSchema }),
  ({ id, list }, context) => useCases.lists().update(context, id, list),
);

export const deleteListAction = tenantAction(z.object({ id: z.uuid() }), ({ id }, context) =>
  useCases.lists().delete(context, id),
);

export const previewSegmentCountAction = tenantAction(
  z.object({ rules: segmentRuleSetSchema }),
  ({ rules }, context) => useCases.segments().previewCount(context, rules),
  { refresh: false },
);

export const createSegmentAction = tenantAction(segmentInputSchema, async (input, context) => {
  const segment = await useCases.segments().create(context, input);
  return { id: segment.id };
});

export const updateSegmentAction = tenantAction(
  z.object({ id: z.uuid(), segment: segmentInputSchema }),
  async ({ id, segment }, context) => {
    await useCases.segments().update(context, id, segment);
    return { id };
  },
);

export const deleteSegmentAction = tenantAction(z.object({ id: z.uuid() }), ({ id }, context) =>
  useCases.segments().delete(context, id),
);
