/**
 * Buzón de novedades (changelog) de cada aplicación. Los productos publican sus novedades por la
 * API (`POST /api/v1/changelog`) o se añaden a mano; las automatizaciones las usan como fuente del
 * resumen semanal y las marcan como enviadas para no repetirlas.
 *
 * El alta con `externalId` es idempotente: el mismo id actualiza la novedad en lugar de duplicarla.
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';

export const CHANGELOG_CATEGORIES = ['FEATURE', 'IMPROVEMENT', 'FIX', 'SECURITY', 'OTHER'] as const;
export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null);

export const changelogEntryInputSchema = z.object({
  externalId: nullableText(120),
  version: nullableText(40),
  title: z.string().trim().min(3).max(200),
  bodyMd: z.string().trim().max(10_000).default(''),
  category: z.enum(CHANGELOG_CATEGORIES).default('OTHER'),
  publishedAt: z.coerce.date().optional(),
});

export type ChangelogEntryInput = z.infer<typeof changelogEntryInputSchema>;

export interface ChangelogEntryView {
  id: string;
  externalId: string | null;
  version: string | null;
  title: string;
  bodyMd: string;
  category: ChangelogCategory;
  publishedAt: Date;
  consumedByRunId: string | null;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface ChangelogRepository {
  list(context: TenantContext, limit: number): Promise<ChangelogEntryView[]>;
  /** Crea o, si `externalId` ya existe, actualiza. */
  upsert(
    context: TenantContext,
    input: Omit<ChangelogEntryInput, 'publishedAt'> & { publishedAt: Date },
  ): Promise<{ entry: ChangelogEntryView; created: boolean }>;
  delete(context: TenantContext, entryId: string): Promise<boolean>;
  findForSources(
    context: TenantContext,
    since: Date,
    onlyNew: boolean,
    limit: number,
  ): Promise<ChangelogEntryView[]>;
  markConsumed(
    context: TenantContext,
    entryIds: readonly string[],
    runId: string,
    at: Date,
  ): Promise<void>;
}

export class ManageChangelogUseCase {
  constructor(
    private readonly deps: { changelog: ChangelogRepository; audit: AuditLogger; clock: Clock },
  ) {}

  list(context: TenantContext, limit = 200) {
    assertCan(context, 'changelog:read');
    return this.deps.changelog.list(context, Math.min(Math.max(limit, 1), 500));
  }

  async publish(context: TenantContext, input: ChangelogEntryInput) {
    assertCan(context, 'changelog:write');
    const result = await this.deps.changelog.upsert(context, {
      ...input,
      publishedAt: input.publishedAt ?? this.deps.clock.now(),
    });
    await this.deps.audit.record(context, {
      action: result.created ? 'changelog.created' : 'changelog.updated',
      entityType: 'changelog_entry',
      entityId: result.entry.id,
      metadata: { category: result.entry.category, version: result.entry.version },
    });
    return result;
  }

  async delete(context: TenantContext, entryId: string) {
    assertCan(context, 'changelog:write');
    if (!(await this.deps.changelog.delete(context, entryId))) {
      throw new DomainError('NOT_FOUND', 'Novedad inexistente');
    }
    await this.deps.audit.record(context, {
      action: 'changelog.deleted',
      entityType: 'changelog_entry',
      entityId: entryId,
    });
  }
}
