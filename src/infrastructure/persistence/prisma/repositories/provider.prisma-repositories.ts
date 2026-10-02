/** Repositorios de proveedores de correo y remitentes. */
import type {
  DnsCheckResult,
  ProviderStatus,
  ProviderView,
  SenderView,
} from '@/core/providers/provider-config';
import type {
  ProviderConfigRepository,
  ProviderWrite,
  SenderRepository,
  StoredProvider,
} from '@/core/providers/ports';
import { DomainError } from '@/core/shared/domain-error';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { Prisma, PrismaClient } from '../generated/client';
import { withDomainErrors } from '../prisma-errors';
import type { TenantClientCache } from '../tenant-scope.extension';

const PROVIDER_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  kind: true,
  settings: true,
  credentialsEnc: true,
  endpointToken: true,
  rateLimitPerSecond: true,
  maxPerDay: true,
  status: true,
  lastError: true,
  lastVerifiedAt: true,
  configVersion: true,
  isDefault: true,
  _count: { select: { senders: true } },
} as const;

type ProviderRow = Prisma.EmailProviderConfigGetPayload<{ select: typeof PROVIDER_SELECT }>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStored(row: ProviderRow): StoredProvider {
  const { _count, settings, credentialsEnc, ...rest } = row;
  return {
    ...rest,
    settings: asRecord(settings),
    credentialsEnc,
    hasCredentials: credentialsEnc !== null,
    senderCount: _count.senders,
  };
}

function toView(row: ProviderRow): ProviderView {
  const { credentialsEnc: _secret, tenantId: _tenant, ...view } = toStored(row);
  return view;
}

export class PrismaProviderConfigRepository implements ProviderConfigRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  async list(context: TenantContext): Promise<ProviderView[]> {
    const rows = await this.clients
      .forTenant(context.tenantId)
      .emailProviderConfig.findMany({ select: PROVIDER_SELECT, orderBy: { createdAt: 'asc' } });
    return rows.map(toView);
  }

  async findById(context: TenantContext, providerId: string): Promise<StoredProvider | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .emailProviderConfig.findFirst({ where: { id: providerId }, select: PROVIDER_SELECT });
    return row ? toStored(row) : null;
  }

  async findByEndpointToken(endpointToken: string): Promise<StoredProvider | null> {
    const row = await this.prisma.emailProviderConfig.findUnique({
      where: { endpointToken },
      select: PROVIDER_SELECT,
    });
    return row ? toStored(row) : null;
  }

  create(
    context: TenantContext,
    id: string,
    endpointToken: string,
    input: ProviderWrite,
  ): Promise<ProviderView> {
    const scoped = this.clients.forTenant(context.tenantId);
    return withDomainErrors(
      () =>
        scoped.$transaction(async (tx) => {
          if (input.isDefault) {
            await tx.emailProviderConfig.updateMany({ where: {}, data: { isDefault: false } });
          }
          const row = await tx.emailProviderConfig.create({
            data: {
              id,
              tenantId: context.tenantId,
              endpointToken,
              ...input,
              settings: input.settings as Prisma.InputJsonObject,
            },
            select: PROVIDER_SELECT,
          });
          return toView(row);
        }),
      'name',
    );
  }

  update(context: TenantContext, providerId: string, input: ProviderWrite): Promise<ProviderView> {
    const scoped = this.clients.forTenant(context.tenantId);
    return withDomainErrors(
      () =>
        scoped.$transaction(async (tx) => {
          if (input.isDefault) {
            await tx.emailProviderConfig.updateMany({
              where: { id: { not: providerId } },
              data: { isDefault: false },
            });
          }
          await tx.emailProviderConfig.updateMany({
            where: { id: providerId },
            data: {
              ...input,
              settings: input.settings as Prisma.InputJsonObject,
              // Un cambio de configuración invalida las conexiones en caché y exige verificar.
              configVersion: { increment: 1 },
              status: 'ACTIVE',
              lastError: null,
            },
          });
          const row = await tx.emailProviderConfig.findFirstOrThrow({
            where: { id: providerId },
            select: PROVIDER_SELECT,
          });
          return toView(row);
        }),
      'name',
    );
  }

  async setStatus(
    context: TenantContext,
    providerId: string,
    status: ProviderStatus,
    lastError: string | null,
    verifiedAt: Date | null,
  ): Promise<void> {
    await this.clients.forTenant(context.tenantId).emailProviderConfig.updateMany({
      where: { id: providerId },
      data: { status, lastError, ...(verifiedAt ? { lastVerifiedAt: verifiedAt } : {}) },
    });
  }

  async delete(context: TenantContext, providerId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .emailProviderConfig.deleteMany({ where: { id: providerId } });
    return count > 0;
  }
}

const SENDER_SELECT = {
  id: true,
  providerConfigId: true,
  fromName: true,
  fromEmail: true,
  replyTo: true,
  isDefault: true,
  dnsCheck: true,
  dnsCheckedAt: true,
  provider: { select: { name: true, kind: true } },
} as const;

type SenderRow = Prisma.SenderIdentityGetPayload<{ select: typeof SENDER_SELECT }>;

function parseDnsCheck(value: unknown): DnsCheckResult | null {
  const record = asRecord(value);
  const status = (key: string) => {
    const raw = record[key];
    return raw === 'pass' || raw === 'missing' || raw === 'fail' ? raw : null;
  };
  const spf = status('spf');
  const dkim = status('dkim');
  const dmarc = status('dmarc');
  if (!spf || !dkim || !dmarc || typeof record.domain !== 'string') return null;
  return {
    domain: record.domain,
    spf,
    dkim,
    dmarc,
    dkimSelector: typeof record.dkimSelector === 'string' ? record.dkimSelector : null,
  };
}

function toSender(row: SenderRow): SenderView {
  const { provider, dnsCheck, ...rest } = row;
  return {
    ...rest,
    providerName: provider.name,
    providerKind: provider.kind,
    dnsCheck: parseDnsCheck(dnsCheck),
  };
}

export class PrismaSenderRepository implements SenderRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async list(context: TenantContext): Promise<SenderView[]> {
    const rows = await this.clients
      .forTenant(context.tenantId)
      .senderIdentity.findMany({ select: SENDER_SELECT, orderBy: { createdAt: 'asc' } });
    return rows.map(toSender);
  }

  async findById(context: TenantContext, senderId: string): Promise<SenderView | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .senderIdentity.findFirst({ where: { id: senderId }, select: SENDER_SELECT });
    return row ? toSender(row) : null;
  }

  create(
    context: TenantContext,
    input: Parameters<SenderRepository['create']>[1],
  ): Promise<SenderView> {
    const scoped = this.clients.forTenant(context.tenantId);
    return withDomainErrors(
      () =>
        scoped.$transaction(async (tx) => {
          if (input.isDefault) {
            await tx.senderIdentity.updateMany({ where: {}, data: { isDefault: false } });
          }
          const row = await tx.senderIdentity.create({
            data: { ...input, tenantId: context.tenantId },
            select: SENDER_SELECT,
          });
          return toSender(row);
        }),
      'fromEmail',
    );
  }

  update(
    context: TenantContext,
    senderId: string,
    input: Parameters<SenderRepository['update']>[2],
  ): Promise<SenderView> {
    const scoped = this.clients.forTenant(context.tenantId);
    return withDomainErrors(
      () =>
        scoped.$transaction(async (tx) => {
          if (input.isDefault) {
            await tx.senderIdentity.updateMany({
              where: { id: { not: senderId } },
              data: { isDefault: false },
            });
          }
          const { count } = await tx.senderIdentity.updateMany({
            where: { id: senderId },
            data: input,
          });
          if (count === 0) throw new DomainError('NOT_FOUND', 'Remitente inexistente');
          return toSender(
            await tx.senderIdentity.findFirstOrThrow({
              where: { id: senderId },
              select: SENDER_SELECT,
            }),
          );
        }),
      'fromEmail',
    );
  }

  async saveDnsCheck(
    context: TenantContext,
    senderId: string,
    check: DnsCheckResult,
    at: Date,
  ): Promise<void> {
    await this.clients.forTenant(context.tenantId).senderIdentity.updateMany({
      where: { id: senderId },
      data: { dnsCheck: { ...check }, dnsCheckedAt: at },
    });
  }

  async delete(context: TenantContext, senderId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .senderIdentity.deleteMany({ where: { id: senderId } });
    return count > 0;
  }
}
