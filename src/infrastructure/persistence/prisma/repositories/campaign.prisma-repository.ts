/** Repositorio de campañas: borrador con versión optimista, transiciones atómicas y contenido compilado. */
import {
  audienceSchema,
  type CampaignRecord,
  type CampaignStatus,
  type CampaignSummary,
} from '@/core/campaigns/campaign';
import type {
  CampaignDraftPatch,
  CampaignLinkRecord,
  CampaignRef,
  CampaignRepository,
  CampaignTransitionPatch,
  CompiledCampaign,
} from '@/core/campaigns/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { templateBodySchema } from '@/core/templates/email-content';
import type { Prisma, PrismaClient } from '../generated/client';
import type { TenantClientCache } from '../tenant-scope.extension';

const SUMMARY_SELECT = {
  id: true,
  name: true,
  status: true,
  scheduledAt: true,
  recipientCount: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const RECORD_SELECT = {
  ...SUMMARY_SELECT,
  templateId: true,
  templateVersion: true,
  body: true,
  subjectB: true,
  senderIdentityId: true,
  topicId: true,
  audience: true,
  throttlePerHour: true,
  trackOpens: true,
  trackClicks: true,
  version: true,
  dispatchCursor: true,
  dispatchedAt: true,
  error: true,
  createdById: true,
} as const;

type RecordRow = Prisma.CampaignGetPayload<{ select: typeof RECORD_SELECT }>;

function toRecord(row: RecordRow): CampaignRecord {
  const audience = audienceSchema.safeParse(row.audience);
  const body = row.body === null ? null : templateBodySchema.safeParse(row.body);
  return {
    ...row,
    audience: audience.success
      ? audience.data
      : { listIds: [], segmentIds: [], excludeListIds: [] },
    body: body?.success ? body.data : null,
  };
}

function draftData(patch: CampaignDraftPatch) {
  return {
    name: patch.name,
    templateId: patch.templateId,
    audience: { ...patch.audience },
    topicId: patch.topicId,
    senderIdentityId: patch.senderIdentityId,
    subjectB: patch.subjectB,
    trackOpens: patch.trackOpens,
    trackClicks: patch.trackClicks,
    throttlePerHour: patch.throttlePerHour,
  };
}

export class PrismaCampaignRepository implements CampaignRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  list(context: TenantContext): Promise<CampaignSummary[]> {
    return this.clients
      .forTenant(context.tenantId)
      .campaign.findMany({ select: SUMMARY_SELECT, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async findById(context: TenantContext, campaignId: string): Promise<CampaignRecord | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .campaign.findFirst({ where: { id: campaignId }, select: RECORD_SELECT });
    return row ? toRecord(row) : null;
  }

  async create(
    context: TenantContext,
    input: Parameters<CampaignRepository['create']>[1],
  ): Promise<CampaignRecord> {
    const row = await this.clients.forTenant(context.tenantId).campaign.create({
      data: {
        tenantId: context.tenantId,
        name: input.name,
        templateId: input.templateId,
        senderIdentityId: input.senderIdentityId,
        createdById: input.createdById,
        ...(input.copyFrom ? draftData(input.copyFrom) : {}),
      },
      select: RECORD_SELECT,
    });
    return toRecord(row);
  }

  async updateDraft(
    context: TenantContext,
    campaignId: string,
    expectedVersion: number,
    patch: CampaignDraftPatch,
  ): Promise<CampaignRecord | null> {
    const { count } = await this.clients.forTenant(context.tenantId).campaign.updateMany({
      where: { id: campaignId, status: 'DRAFT', version: expectedVersion },
      data: { ...draftData(patch), version: { increment: 1 } },
    });
    return count === 0 ? null : this.findById(context, campaignId);
  }

  async transition(
    context: TenantContext,
    campaignId: string,
    from: readonly CampaignStatus[],
    to: CampaignStatus,
    patch: CampaignTransitionPatch = {},
  ): Promise<boolean> {
    const { bumpVersion, body, ...rest } = patch;
    const { count } = await this.clients.forTenant(context.tenantId).campaign.updateMany({
      where: { id: campaignId, status: { in: [...from] } },
      data: {
        ...rest,
        ...(body !== undefined
          ? { body: body === null ? undefined : (body as Prisma.InputJsonObject) }
          : {}),
        status: to,
        ...(bumpVersion ? { version: { increment: 1 } } : {}),
      },
    });
    return count > 0;
  }

  async saveCompiled(
    context: TenantContext,
    campaignId: string,
    compiled: CompiledCampaign,
    links: readonly string[],
  ): Promise<void> {
    await this.clients.forTenant(context.tenantId).$transaction(async (tx) => {
      await tx.campaign.updateMany({
        where: { id: campaignId },
        data: {
          compiledSubject: compiled.subject,
          compiledHtml: compiled.html,
          compiledText: compiled.text,
          subjectB: compiled.subjectB,
        },
      });
      await tx.campaignLink.deleteMany({ where: { campaignId } });
      if (links.length > 0) {
        await tx.campaignLink.createMany({
          data: links.map((url, position) => ({
            tenantId: context.tenantId,
            campaignId,
            position,
            url,
          })),
        });
      }
    });
  }

  async findCompiled(context: TenantContext, campaignId: string): Promise<CompiledCampaign | null> {
    const row = await this.clients.forTenant(context.tenantId).campaign.findFirst({
      where: { id: campaignId },
      select: { compiledSubject: true, compiledHtml: true, compiledText: true, subjectB: true },
    });
    if (!row?.compiledHtml || row.compiledSubject === null || row.compiledText === null)
      return null;
    return {
      subject: row.compiledSubject,
      subjectB: row.subjectB,
      html: row.compiledHtml,
      text: row.compiledText,
    };
  }

  findLink(
    context: TenantContext,
    campaignId: string,
    linkId: string,
  ): Promise<CampaignLinkRecord | null> {
    return this.clients.forTenant(context.tenantId).campaignLink.findFirst({
      where: { id: linkId, campaignId },
      select: { id: true, position: true, url: true },
    });
  }

  findLinks(context: TenantContext, campaignId: string): Promise<CampaignLinkRecord[]> {
    return this.clients.forTenant(context.tenantId).campaignLink.findMany({
      where: { campaignId },
      select: { id: true, position: true, url: true },
      orderBy: { position: 'asc' },
    });
  }

  async setDispatchCursor(
    context: TenantContext,
    campaignId: string,
    cursor: string,
  ): Promise<void> {
    await this.clients
      .forTenant(context.tenantId)
      .campaign.updateMany({ where: { id: campaignId }, data: { dispatchCursor: cursor } });
  }

  async delete(context: TenantContext, campaignId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .campaign.deleteMany({ where: { id: campaignId } });
    return count > 0;
  }

  async findDue(now: Date): Promise<CampaignRef[]> {
    const rows = await this.prisma.campaign.findMany({
      where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
      select: { id: true, version: true, tenant: { select: { id: true, slug: true } } },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      tenantId: row.tenant.id,
      tenantSlug: row.tenant.slug,
    }));
  }

  async findSending(): Promise<CampaignRef[]> {
    const rows = await this.prisma.campaign.findMany({
      where: { status: 'SENDING' },
      select: { id: true, version: true, tenant: { select: { id: true, slug: true } } },
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      version: row.version,
      tenantId: row.tenant.id,
      tenantSlug: row.tenant.slug,
    }));
  }
}
