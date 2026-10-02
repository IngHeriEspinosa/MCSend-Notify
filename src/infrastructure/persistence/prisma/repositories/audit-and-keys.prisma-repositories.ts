/** Auditoría (solo inserción) y claves de API. */
import { isApiScope, type ApiScope } from '@/core/api-keys/api-scopes';
import type { ApiKeyLookup, ApiKeyRepository, ApiKeyView } from '@/core/api-keys/api-keys';
import type { AuditEntry, AuditLogger, AuditLogReader, AuditRecord } from '@/core/audit/audit-log';
import type { Page, PageRequest } from '@/core/shared/pagination';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { Prisma, PrismaClient } from '../generated/client';
import type { TenantClientCache } from '../tenant-scope.extension';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class PrismaAuditLogger implements AuditLogger, AuditLogReader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  async record(context: TenantContext | null, entry: AuditEntry): Promise<void> {
    const actor = context?.actor;
    await this.prisma.auditLog.create({
      data: {
        tenantId: context?.tenantId ?? null,
        actorUserId: actor?.type === 'user' ? actor.userId : null,
        actorApiKeyId: actor?.type === 'apiKey' ? actor.apiKeyId : null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
        ip: context?.requestMeta?.ip ?? null,
        userAgent: context?.requestMeta?.userAgent?.slice(0, 300) ?? null,
      },
    });
  }

  async list(context: TenantContext, page: PageRequest): Promise<Page<AuditRecord>> {
    const scoped = this.clients.forTenant(context.tenantId);
    const [rows, total] = await Promise.all([
      scoped.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: page.page * page.pageSize,
        take: page.pageSize,
      }),
      scoped.auditLog.count(),
    ]);
    const userIds = [
      ...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => id !== null)),
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true },
    });
    const emailById = new Map(users.map((user) => [user.id, user.email]));
    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId ?? undefined,
        metadata: isRecord(row.metadata) ? row.metadata : {},
        actorUserId: row.actorUserId,
        actorUserEmail: row.actorUserId ? (emailById.get(row.actorUserId) ?? null) : null,
        actorApiKeyId: row.actorApiKeyId,
        ip: row.ip,
        createdAt: row.createdAt,
      })),
      total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }
}

const API_KEY_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

function toApiKeyView(row: Omit<ApiKeyView, 'scopes'> & { scopes: string[] }): ApiKeyView {
  return { ...row, scopes: row.scopes.filter((scope): scope is ApiScope => isApiScope(scope)) };
}

/** Evita una escritura por petición: el último uso se actualiza como mucho cada minuto. */
const TOUCH_INTERVAL_MS = 60_000;

export class PrismaApiKeyRepository implements ApiKeyRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  async create(
    context: TenantContext,
    input: Pick<ApiKeyView, 'name' | 'prefix' | 'scopes' | 'expiresAt'> & {
      keyHash: string;
      createdById: string;
    },
  ): Promise<ApiKeyView> {
    const row = await this.clients.forTenant(context.tenantId).apiKey.create({
      data: { ...input, tenantId: context.tenantId },
      select: API_KEY_SELECT,
    });
    return toApiKeyView(row);
  }

  async list(context: TenantContext): Promise<ApiKeyView[]> {
    const rows = await this.clients
      .forTenant(context.tenantId)
      .apiKey.findMany({ select: API_KEY_SELECT, orderBy: { createdAt: 'desc' } });
    return rows.map(toApiKeyView);
  }

  async revoke(context: TenantContext, apiKeyId: string, at: Date): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .apiKey.updateMany({ where: { id: apiKeyId, revokedAt: null }, data: { revokedAt: at } });
    return count > 0;
  }

  async findByHash(keyHash: string): Promise<ApiKeyLookup | null> {
    // Consulta global intencionada: la clave identifica al tenant.
    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        ...API_KEY_SELECT,
        tenantId: true,
        tenant: { select: { slug: true, status: true } },
      },
    });
    if (!row) return null;
    const { tenant, ...rest } = row;
    return {
      ...toApiKeyView(rest),
      tenantId: row.tenantId,
      tenantSlug: tenant.slug,
      tenantActive: tenant.status === 'ACTIVE',
    };
  }

  async touch(apiKeyId: string, at: Date): Promise<void> {
    await this.prisma.apiKey.updateMany({
      where: {
        id: apiKeyId,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(at.getTime() - TOUCH_INTERVAL_MS) } },
        ],
      },
      data: { lastUsedAt: at },
    });
  }
}
