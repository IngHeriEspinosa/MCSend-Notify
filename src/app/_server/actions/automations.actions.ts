'use server';

/** Server Actions de automatizaciones, aprobaciones y buzón de novedades. */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import { automationInputSchema } from '@/core/automations/automation';
import { approveSchema, rejectSchema } from '@/core/automations/use-cases/approvals.use-cases';
import { changelogEntryInputSchema } from '@/core/changelog/changelog';
import { useCases } from '@/infrastructure/use-case-factory';

const idSchema = z.object({ id: z.uuid() });

export const createAutomationAction = tenantAction(
  automationInputSchema,
  async (input, context) => {
    const automation = await useCases.automations().create(context, input);
    return { id: automation.id };
  },
);

export const updateAutomationAction = tenantAction(
  z.object({ id: z.uuid(), automation: automationInputSchema }),
  async ({ id, automation }, context) => {
    await useCases.automations().update(context, id, automation);
  },
);

export const setAutomationEnabledAction = tenantAction(
  z.object({ id: z.uuid(), enabled: z.boolean() }),
  ({ id, enabled }, context) => useCases.automations().setEnabled(context, id, enabled),
);

export const deleteAutomationAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.automations().delete(context, id),
);

export const runAutomationNowAction = tenantAction(idSchema, async ({ id }, context) => {
  await useCases.automations().runNow(context, id);
});

export const approveCampaignAction = tenantAction(approveSchema, (input, context) =>
  useCases.approvals().approve(context, input),
);

export const rejectCampaignAction = tenantAction(rejectSchema, (input, context) =>
  useCases.approvals().reject(context, input),
);

export const publishChangelogAction = tenantAction(
  changelogEntryInputSchema,
  async (input, context) => {
    await useCases.changelog().publish(context, input);
  },
);

export const deleteChangelogAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.changelog().delete(context, id),
);
