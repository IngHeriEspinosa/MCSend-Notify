/** Repositorios de configuración y uso de IA. */
import type {
  AiSettingsRepository,
  AiSettingsWrite,
  AiUsageRepository,
  AiUsageSummary,
  NewAiUsage,
  StoredAiSettings,
} from '@/core/ai/ports';
import type { ProviderStatus } from '@/core/providers/provider-config';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { Prisma } from '../generated/client';
import type { TenantClientCache } from '../tenant-scope.extension';

const SETTINGS_SELECT = {
  id: true,
  source: true,
  kind: true,
  credentialsEnc: true,
  baseUrl: true,
  defaultModel: true,
  fastModel: true,
  monthlyBudgetUsd: true,
  inputPricePerMTok: true,
  outputPricePerMTok: true,
  status: true,
  lastError: true,
  lastVerifiedAt: true,
  configVersion: true,
} as const;

type SettingsRow = Prisma.AiSettingsGetPayload<{ select: typeof SETTINGS_SELECT }>;

function toStored(row: SettingsRow): StoredAiSettings {
  return { ...row, hasApiKey: row.credentialsEnc !== null };
}

export class PrismaAiSettingsRepository implements AiSettingsRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async find(context: TenantContext): Promise<StoredAiSettings | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .aiSettings.findFirst({ select: SETTINGS_SELECT });
    return row ? toStored(row) : null;
  }

  async save(
    context: TenantContext,
    id: string,
    write: AiSettingsWrite,
  ): Promise<StoredAiSettings> {
    const row = await this.clients.forTenant(context.tenantId).aiSettings.upsert({
      where: { tenantId: context.tenantId },
      create: { id, tenantId: context.tenantId, ...write },
      update: { ...write, configVersion: { increment: 1 }, status: 'ACTIVE', lastError: null },
      select: SETTINGS_SELECT,
    });
    return toStored(row);
  }

  async setStatus(
    context: TenantContext,
    status: ProviderStatus,
    lastError: string | null,
    verifiedAt: Date | null,
  ): Promise<void> {
    await this.clients.forTenant(context.tenantId).aiSettings.updateMany({
      where: {},
      data: { status, lastError, ...(verifiedAt ? { lastVerifiedAt: verifiedAt } : {}) },
    });
  }

  async delete(context: TenantContext): Promise<boolean> {
    const { count } = await this.clients.forTenant(context.tenantId).aiSettings.deleteMany({});
    return count > 0;
  }
}

export class PrismaAiUsageRepository implements AiUsageRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async record(context: TenantContext, entry: NewAiUsage): Promise<void> {
    await this.clients.forTenant(context.tenantId).aiUsage.create({
      data: { tenantId: context.tenantId, ...entry },
    });
  }

  async spentSince(context: TenantContext, since: Date): Promise<number> {
    const result = await this.clients.forTenant(context.tenantId).aiUsage.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { costMicros: true },
    });
    return result._sum.costMicros ?? 0;
  }

  async summary(context: TenantContext, since: Date): Promise<AiUsageSummary> {
    const scoped = this.clients.forTenant(context.tenantId);
    const where = { createdAt: { gte: since } };
    const [groups, errors] = await Promise.all([
      scoped.aiUsage.groupBy({
        by: ['purpose'],
        where,
        _count: { _all: true },
        _sum: { costMicros: true, inputTokens: true, outputTokens: true },
      }),
      scoped.aiUsage.count({ where: { ...where, status: { not: 'OK' } } }),
    ]);
    const byPurpose = groups
      .map((group) => ({
        purpose: group.purpose,
        calls: group._count._all,
        costMicros: group._sum.costMicros ?? 0,
        inputTokens: group._sum.inputTokens ?? 0,
        outputTokens: group._sum.outputTokens ?? 0,
      }))
      .sort((a, b) => b.costMicros - a.costMicros);
    return {
      since,
      calls: byPurpose.reduce((total, group) => total + group.calls, 0),
      errors,
      costMicros: byPurpose.reduce((total, group) => total + group.costMicros, 0),
      byPurpose,
    };
  }
}
