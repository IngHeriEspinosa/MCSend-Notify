'use server';

/**
 * Server Actions de IA: configuración del tenant y asistencia (borrador, asuntos, traducción,
 * tono, segmentos y resumen de resultados). Las de asistencia tienen un límite de 30 peticiones
 * por hora y usuario, además del presupuesto mensual del tenant.
 */
import { tenantAction } from '@/app/_server/action-client';
import { aiSettingsInputSchema } from '@/core/ai/ai';
import {
  adjustToneSchema,
  draftCampaignSchema,
  segmentFromTextSchema,
  suggestSubjectsSchema,
  summarizeResultsSchema,
  translateSchema,
} from '@/core/ai/use-cases/ai-assist.use-cases';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import { getRateLimiter } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';
import { z } from 'zod';

async function limited(context: TenantContext): Promise<void> {
  await getRateLimiter('aiAssist').consume(`${context.tenantId}:${actorUserId(context) ?? 'anon'}`);
}

export const saveAiSettingsAction = tenantAction(aiSettingsInputSchema, async (input, context) => {
  await useCases.aiSettings().save(context, input);
});

export const verifyAiSettingsAction = tenantAction(z.object({}), async (_input, context) => {
  await limited(context);
  return useCases.aiSettings().verify(context);
});

export const disableAiAction = tenantAction(z.object({}), (_input, context) =>
  useCases.aiSettings().disable(context),
);

export const draftCampaignAction = tenantAction(
  draftCampaignSchema,
  async (input, context) => {
    await limited(context);
    return useCases.aiAssist().draftCampaign(context, input);
  },
  { refresh: false },
);

export const suggestSubjectsAction = tenantAction(
  suggestSubjectsSchema,
  async (input, context) => {
    await limited(context);
    return useCases.aiAssist().suggestSubjects(context, input);
  },
  { refresh: false },
);

export const translateTemplateAction = tenantAction(
  translateSchema,
  async (input, context) => {
    await limited(context);
    return useCases.aiAssist().translate(context, input);
  },
  { refresh: false },
);

export const adjustToneAction = tenantAction(
  adjustToneSchema,
  async (input, context) => {
    await limited(context);
    return useCases.aiAssist().adjustTone(context, input);
  },
  { refresh: false },
);

export const segmentFromTextAction = tenantAction(
  segmentFromTextSchema,
  async (input, context) => {
    await limited(context);
    return useCases.aiAssist().segmentFromText(context, input);
  },
  { refresh: false },
);

export const summarizeResultsAction = tenantAction(
  summarizeResultsSchema,
  async (input, context) => {
    await limited(context);
    return useCases.aiAssist().summarizeResults(context, input);
  },
  { refresh: false },
);
