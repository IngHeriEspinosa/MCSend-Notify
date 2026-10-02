'use server';

/** Server Actions de campañas. */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import {
  createCampaignSchema,
  scheduleCampaignSchema,
  sendTestSchema,
  updateCampaignSchema,
} from '@/core/campaigns/campaign';
import { DELIVERY_STATUSES } from '@/core/campaigns/delivery';
import {
  audienceCountSchema,
  campaignPreviewSchema,
} from '@/core/campaigns/use-cases/campaigns.use-cases';
import { getRateLimiter } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

const campaignIdSchema = z.object({ campaignId: z.uuid() });

export const createCampaignAction = tenantAction(createCampaignSchema, async (input, context) => {
  const campaign = await useCases.campaigns().create(context, input);
  return { id: campaign.id };
});

export const updateCampaignAction = tenantAction(
  updateCampaignSchema,
  async (input, context) => {
    const campaign = await useCases.campaigns().update(context, input);
    return { version: campaign.version };
  },
  { refresh: false },
);

export const duplicateCampaignAction = tenantAction(
  z.object({ campaignId: z.uuid(), name: z.string().trim().min(2).max(120) }),
  async ({ campaignId, name }, context) => {
    const campaign = await useCases.campaigns().duplicate(context, campaignId, name);
    return { id: campaign.id };
  },
);

export const deleteCampaignAction = tenantAction(campaignIdSchema, ({ campaignId }, context) =>
  useCases.campaigns().delete(context, campaignId),
);

export const countAudienceAction = tenantAction(
  audienceCountSchema,
  ({ audience, topicId }, context) =>
    useCases.campaigns().countAudience(context, audience, topicId),
  { refresh: false },
);

export const campaignChecksAction = tenantAction(
  campaignIdSchema,
  ({ campaignId }, context) => useCases.campaigns().checks(context, campaignId),
  { refresh: false },
);

export const campaignPreviewAction = tenantAction(
  campaignPreviewSchema,
  (input, context) => useCases.campaigns().preview(context, input),
  { refresh: false },
);

export const sendTestAction = tenantAction(
  sendTestSchema,
  async (input, context) => {
    await getRateLimiter('testSend').consume(`${context.tenantId}:${input.campaignId}`);
    return useCases.campaigns().sendTest(context, input);
  },
  { refresh: false },
);

export const scheduleCampaignAction = tenantAction(scheduleCampaignSchema, (input, context) =>
  useCases.campaigns().schedule(context, input),
);

export const unscheduleCampaignAction = tenantAction(campaignIdSchema, ({ campaignId }, context) =>
  useCases.campaigns().unschedule(context, campaignId),
);

export const pauseCampaignAction = tenantAction(campaignIdSchema, ({ campaignId }, context) =>
  useCases.campaigns().pause(context, campaignId),
);

export const resumeCampaignAction = tenantAction(campaignIdSchema, ({ campaignId }, context) =>
  useCases.campaigns().resume(context, campaignId),
);

export const cancelCampaignAction = tenantAction(campaignIdSchema, ({ campaignId }, context) =>
  useCases.campaigns().cancel(context, campaignId),
);

/** Informe en vivo (sondeo desde la página de la campaña). */
export const campaignReportAction = tenantAction(
  campaignIdSchema,
  async ({ campaignId }, context) => {
    const { campaign, stats, links } = await useCases.campaigns().report(context, campaignId);
    return {
      status: campaign.status,
      error: campaign.error,
      recipientCount: campaign.recipientCount,
      finishedAt: campaign.finishedAt,
      stats,
      links,
    };
  },
  { refresh: false },
);

export const campaignDeliveriesAction = tenantAction(
  z.object({
    campaignId: z.uuid(),
    status: z.enum(DELIVERY_STATUSES).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.number().int().min(0),
    pageSize: z.number().int().min(10).max(100),
  }),
  ({ campaignId, ...query }, context) =>
    useCases.campaigns().deliveries(context, campaignId, query),
  { refresh: false },
);
