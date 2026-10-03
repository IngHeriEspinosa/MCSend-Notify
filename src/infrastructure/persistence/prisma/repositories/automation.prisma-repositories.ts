/**
 * Repositorios de automatizaciones, ejecuciones (idempotentes por clave única), aprobaciones
 * (decisión atómica desde PENDING) y directorio de miembros para avisar a los aprobadores.
 */
import { z } from 'zod';
import {
  automationDefinitionSchema,
  automationScheduleSchema,
  ON_TIMEOUT_ACTIONS,
  type ApprovalRecord,
  type ApprovalStatus,
  type AutomationRecord,
  type AutomationRunRecord,
  type AutomationRunStatus,
  type AutomationSummary,
} from '@/core/automations/automation';
import type {
  ApprovalRepository,
  AutomationRef,
  AutomationRepository,
  AutomationRunRepository,
  AutomationWrite,
  MemberDirectory,
  RunPatch,
  TenantMemberContact,
} from '@/core/automations/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { Prisma, PrismaClient } from '../generated/client';
import { isUniqueViolation, withDomainErrors } from '../prisma-errors';
import type { TenantClientCache } from '../tenant-scope.extension';

const AUTOMATION_SELECT = {
  id: true,
  name: true,
  enabled: true,
  schedule: true,
  timezone: true,
  definition: true,
  createdById: true,
  lastRunAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type AutomationRow = Prisma.AutomationGetPayload<{ select: typeof AUTOMATION_SELECT }>;

function toAutomation(row: AutomationRow): AutomationRecord {
  return {
    ...row,
    schedule: automationScheduleSchema.parse(row.schedule),
    definition: automationDefinitionSchema.parse(row.definition),
  };
}

function writeData(input: AutomationWrite) {
  return {
    name: input.name,
    schedule: input.schedule,
    timezone: input.timezone,
    definition: input.definition,
  };
}

export class PrismaAutomationRepository implements AutomationRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  async list(context: TenantContext): Promise<AutomationSummary[]> {
    const rows = await this.clients.forTenant(context.tenantId).automation.findMany({
      select: {
        id: true,
        name: true,
        enabled: true,
        schedule: true,
        timezone: true,
        lastRunAt: true,
        runs: { select: { status: true }, orderBy: { startedAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ runs, schedule, ...row }) => ({
      ...row,
      schedule: automationScheduleSchema.parse(schedule),
      lastRunStatus: runs[0]?.status ?? null,
    }));
  }

  async findById(context: TenantContext, automationId: string): Promise<AutomationRecord | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .automation.findFirst({ where: { id: automationId }, select: AUTOMATION_SELECT });
    return row ? toAutomation(row) : null;
  }

  create(context: TenantContext, input: AutomationWrite & { createdById: string }) {
    return withDomainErrors(async () => {
      const row = await this.clients.forTenant(context.tenantId).automation.create({
        data: { tenantId: context.tenantId, createdById: input.createdById, ...writeData(input) },
        select: AUTOMATION_SELECT,
      });
      return toAutomation(row);
    }, 'name');
  }

  update(context: TenantContext, automationId: string, input: AutomationWrite) {
    const scoped = this.clients.forTenant(context.tenantId);
    return withDomainErrors(async () => {
      await scoped.automation.updateMany({ where: { id: automationId }, data: writeData(input) });
      const row = await scoped.automation.findFirstOrThrow({
        where: { id: automationId },
        select: AUTOMATION_SELECT,
      });
      return toAutomation(row);
    }, 'name');
  }

  async setEnabled(context: TenantContext, automationId: string, enabled: boolean) {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .automation.updateMany({ where: { id: automationId }, data: { enabled } });
    return count > 0;
  }

  async setLastRun(context: TenantContext, automationId: string, at: Date) {
    await this.clients
      .forTenant(context.tenantId)
      .automation.updateMany({ where: { id: automationId }, data: { lastRunAt: at } });
  }

  async delete(context: TenantContext, automationId: string) {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .automation.deleteMany({ where: { id: automationId } });
    return count > 0;
  }

  async listEnabled(): Promise<AutomationRef[]> {
    const rows = await this.prisma.automation.findMany({
      where: { enabled: true, tenant: { status: 'ACTIVE' } },
      select: {
        id: true,
        tenantId: true,
        schedule: true,
        timezone: true,
        tenant: { select: { slug: true } },
      },
    });
    return rows.flatMap((row) => {
      const schedule = automationScheduleSchema.safeParse(row.schedule);
      return schedule.success
        ? [
            {
              id: row.id,
              tenantId: row.tenantId,
              tenantSlug: row.tenant.slug,
              schedule: schedule.data,
              timezone: row.timezone,
            },
          ]
        : [];
    });
  }
}

const sourceSummarySchema = z.array(
  z.object({
    kind: z.enum(['text', 'url', 'rss', 'document', 'changelog']),
    title: z.string(),
    chars: z.number(),
  }),
);
const stringArraySchema = z.array(z.string());

const RUN_SELECT = {
  id: true,
  automationId: true,
  idempotencyKey: true,
  trigger: true,
  status: true,
  campaignId: true,
  templateId: true,
  sources: true,
  removedLinks: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  approval: { select: { id: true, status: true, expiresAt: true } },
} as const;

type RunRow = Prisma.AutomationRunGetPayload<{ select: typeof RUN_SELECT }>;

function toRun(row: RunRow): AutomationRunRecord {
  const sources = sourceSummarySchema.safeParse(row.sources);
  const removed = stringArraySchema.safeParse(row.removedLinks);
  return {
    ...row,
    trigger: row.trigger === 'manual' ? 'manual' : 'schedule',
    sources: sources.success ? sources.data : [],
    removedLinks: removed.success ? removed.data : [],
  };
}

function patchData(patch: RunPatch) {
  return {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.campaignId !== undefined ? { campaignId: patch.campaignId } : {}),
    ...(patch.templateId !== undefined ? { templateId: patch.templateId } : {}),
    ...(patch.sources !== undefined
      ? { sources: patch.sources.map((source) => ({ ...source })) }
      : {}),
    ...(patch.removedLinks !== undefined ? { removedLinks: patch.removedLinks } : {}),
    ...(patch.error !== undefined ? { error: patch.error } : {}),
    ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
  };
}

export class PrismaAutomationRunRepository implements AutomationRunRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async start(
    context: TenantContext,
    input: { automationId: string; idempotencyKey: string; trigger: 'schedule' | 'manual' },
  ) {
    const scoped = this.clients.forTenant(context.tenantId);
    try {
      const row = await scoped.automationRun.create({
        data: { tenantId: context.tenantId, ...input },
        select: RUN_SELECT,
      });
      return { run: toRun(row), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const row = await scoped.automationRun.findFirstOrThrow({
        where: { automationId: input.automationId, idempotencyKey: input.idempotencyKey },
        select: RUN_SELECT,
      });
      return { run: toRun(row), created: false };
    }
  }

  async restart(context: TenantContext, runId: string) {
    const { count } = await this.clients.forTenant(context.tenantId).automationRun.updateMany({
      where: { id: runId, status: 'FAILED' },
      data: { status: 'RUNNING', error: null, finishedAt: null },
    });
    return count > 0;
  }

  async update(context: TenantContext, runId: string, patch: RunPatch) {
    await this.clients
      .forTenant(context.tenantId)
      .automationRun.updateMany({ where: { id: runId }, data: patchData(patch) });
  }

  async transition(
    context: TenantContext,
    runId: string,
    from: readonly AutomationRunStatus[],
    patch: RunPatch & { status: AutomationRunStatus },
  ) {
    const { count } = await this.clients.forTenant(context.tenantId).automationRun.updateMany({
      where: { id: runId, status: { in: [...from] } },
      data: patchData(patch),
    });
    return count > 0;
  }

  async findById(context: TenantContext, runId: string) {
    const row = await this.clients
      .forTenant(context.tenantId)
      .automationRun.findFirst({ where: { id: runId }, select: RUN_SELECT });
    return row ? toRun(row) : null;
  }

  async list(context: TenantContext, automationId: string, limit: number) {
    const rows = await this.clients.forTenant(context.tenantId).automationRun.findMany({
      where: { automationId },
      select: RUN_SELECT,
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return rows.map(toRun);
  }
}

const APPROVAL_SELECT = {
  id: true,
  runId: true,
  campaignId: true,
  approverUserIds: true,
  status: true,
  onTimeout: true,
  expiresAt: true,
  decidedById: true,
  decidedAt: true,
  comment: true,
  createdAt: true,
  run: { select: { automation: { select: { id: true, name: true } } } },
} as const;

type ApprovalRow = Prisma.ApprovalRequestGetPayload<{ select: typeof APPROVAL_SELECT }>;

function toApproval(row: ApprovalRow): ApprovalRecord {
  const { run, onTimeout, ...rest } = row;
  return {
    ...rest,
    onTimeout: ON_TIMEOUT_ACTIONS.find((action) => action === onTimeout) ?? 'cancel',
    automationId: run.automation.id,
    automationName: run.automation.name,
  };
}

export class PrismaApprovalRepository implements ApprovalRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  async create(
    context: TenantContext,
    input: Parameters<ApprovalRepository['create']>[1],
  ): Promise<ApprovalRecord> {
    const row = await this.clients.forTenant(context.tenantId).approvalRequest.create({
      data: { tenantId: context.tenantId, ...input },
      select: APPROVAL_SELECT,
    });
    return toApproval(row);
  }

  async findById(context: TenantContext, approvalId: string) {
    const row = await this.clients
      .forTenant(context.tenantId)
      .approvalRequest.findFirst({ where: { id: approvalId }, select: APPROVAL_SELECT });
    return row ? toApproval(row) : null;
  }

  async list(context: TenantContext, status: ApprovalStatus | null, limit: number) {
    const rows = await this.clients.forTenant(context.tenantId).approvalRequest.findMany({
      where: status ? { status } : {},
      select: APPROVAL_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toApproval);
  }

  countPending(context: TenantContext) {
    return this.clients
      .forTenant(context.tenantId)
      .approvalRequest.count({ where: { status: 'PENDING' } });
  }

  async decide(
    context: TenantContext,
    approvalId: string,
    decision: Parameters<ApprovalRepository['decide']>[2],
  ) {
    const { count } = await this.clients.forTenant(context.tenantId).approvalRequest.updateMany({
      where: { id: approvalId, status: 'PENDING' },
      data: {
        status: decision.status,
        decidedById: decision.decidedById,
        decidedAt: decision.at,
        comment: decision.comment,
      },
    });
    return count > 0;
  }

  async findExpired(now: Date, limit: number) {
    const rows = await this.prisma.approvalRequest.findMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      select: { id: true, tenantId: true, tenant: { select: { slug: true } } },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => ({ id: row.id, tenantId: row.tenantId, tenantSlug: row.tenant.slug }));
  }
}

export class PrismaMemberDirectory implements MemberDirectory {
  constructor(private readonly clients: TenantClientCache) {}

  async findMembers(
    context: TenantContext,
    userIds: readonly string[],
  ): Promise<TenantMemberContact[]> {
    if (userIds.length === 0) return [];
    const rows = await this.clients.forTenant(context.tenantId).tenantMembership.findMany({
      where: { userId: { in: [...userIds] }, user: { isActive: true } },
      select: {
        userId: true,
        role: true,
        user: { select: { email: true, name: true, locale: true } },
      },
    });
    return rows.map((row) => ({
      userId: row.userId,
      role: row.role,
      email: row.user.email,
      name: row.user.name,
      locale: row.user.locale === 'en' ? 'en' : 'es',
    }));
  }
}
