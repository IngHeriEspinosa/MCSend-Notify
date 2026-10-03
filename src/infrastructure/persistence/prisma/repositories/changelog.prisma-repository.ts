/** Repositorio del buzón de novedades (changelog) con alta idempotente por `externalId`. */
import type {
  ChangelogEntryInput,
  ChangelogEntryView,
  ChangelogRepository,
} from '@/core/changelog/changelog';
import type { TenantContext } from '@/core/shared/tenant-context';
import { isUniqueViolation } from '../prisma-errors';
import type { TenantClientCache } from '../tenant-scope.extension';

const ENTRY_SELECT = {
  id: true,
  externalId: true,
  version: true,
  title: true,
  bodyMd: true,
  category: true,
  publishedAt: true,
  consumedByRunId: true,
  consumedAt: true,
  createdAt: true,
} as const;

type EntryWrite = Omit<ChangelogEntryInput, 'publishedAt'> & { publishedAt: Date };

export class PrismaChangelogRepository implements ChangelogRepository {
  constructor(private readonly clients: TenantClientCache) {}

  list(context: TenantContext, limit: number): Promise<ChangelogEntryView[]> {
    return this.clients.forTenant(context.tenantId).changelogEntry.findMany({
      select: ENTRY_SELECT,
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });
  }

  async upsert(
    context: TenantContext,
    input: EntryWrite,
  ): Promise<{ entry: ChangelogEntryView; created: boolean }> {
    const scoped = this.clients.forTenant(context.tenantId);
    const data = {
      version: input.version,
      title: input.title,
      bodyMd: input.bodyMd,
      category: input.category,
      publishedAt: input.publishedAt,
    };
    const update = async (externalId: string) => {
      await scoped.changelogEntry.updateMany({ where: { externalId }, data });
      const entry = await scoped.changelogEntry.findFirstOrThrow({
        where: { externalId },
        select: ENTRY_SELECT,
      });
      return { entry, created: false };
    };

    if (input.externalId) {
      const existing = await scoped.changelogEntry.findFirst({
        where: { externalId: input.externalId },
        select: { id: true },
      });
      if (existing) return update(input.externalId);
    }
    try {
      const entry = await scoped.changelogEntry.create({
        data: { tenantId: context.tenantId, externalId: input.externalId, ...data },
        select: ENTRY_SELECT,
      });
      return { entry, created: true };
    } catch (error) {
      // Dos publicaciones simultáneas con el mismo externalId: la segunda actualiza.
      if (input.externalId && isUniqueViolation(error)) return update(input.externalId);
      throw error;
    }
  }

  async delete(context: TenantContext, entryId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .changelogEntry.deleteMany({ where: { id: entryId } });
    return count > 0;
  }

  findForSources(
    context: TenantContext,
    since: Date,
    onlyNew: boolean,
    limit: number,
  ): Promise<ChangelogEntryView[]> {
    return this.clients.forTenant(context.tenantId).changelogEntry.findMany({
      where: { publishedAt: { gte: since }, ...(onlyNew ? { consumedByRunId: null } : {}) },
      select: ENTRY_SELECT,
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });
  }

  async markConsumed(
    context: TenantContext,
    entryIds: readonly string[],
    runId: string,
    at: Date,
  ): Promise<void> {
    if (entryIds.length === 0) return;
    await this.clients.forTenant(context.tenantId).changelogEntry.updateMany({
      where: { id: { in: [...entryIds] }, consumedByRunId: null },
      data: { consumedByRunId: runId, consumedAt: at },
    });
  }
}
