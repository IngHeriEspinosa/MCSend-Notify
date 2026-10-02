/** Repositorio de tenants. Las búsquedas por slug y membresía son globales por naturaleza. */
import type { MembershipRole } from '@/core/identity/roles';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  parseBranding,
  type BrandingRepository,
  type TenantBranding,
  type TenantEmailProfile,
} from '@/core/tenants/branding';
import type {
  CreateTenantData,
  Tenant,
  TenantRepository,
  TenantStats,
  TenantWithRole,
  UpdateTenantSettingsInput,
} from '@/core/tenants/tenant';
import type { Prisma, PrismaClient } from '../generated/client';
import { withDomainErrors } from '../prisma-errors';
import type { TenantClientCache } from '../tenant-scope.extension';

const TENANT_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  defaultLocale: true,
  timezone: true,
  postalAddress: true,
  onboardingStep: true,
  createdAt: true,
} as const;

export class PrismaTenantRepository implements TenantRepository, BrandingRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  findBySlug(slug: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({ where: { slug }, select: TENANT_SELECT });
  }

  async findMembershipRole(tenantId: string, userId: string): Promise<MembershipRole | null> {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  async listForUser(userId: string): Promise<TenantWithRole[]> {
    const rows = await this.prisma.tenantMembership.findMany({
      where: { userId, tenant: { status: 'ACTIVE' } },
      select: { role: true, tenant: { select: TENANT_SELECT } },
      orderBy: { tenant: { name: 'asc' } },
    });
    return rows.map((row) => ({ tenant: row.tenant, role: row.role }));
  }

  listAll(): Promise<Tenant[]> {
    return this.prisma.tenant.findMany({ select: TENANT_SELECT, orderBy: { name: 'asc' } });
  }

  createWithOwner(input: CreateTenantData, ownerUserId: string): Promise<Tenant> {
    return withDomainErrors(
      () =>
        this.prisma.$transaction(async (tx) => {
          const tenant = await tx.tenant.create({
            data: {
              slug: input.slug,
              name: input.name,
              defaultLocale: input.defaultLocale,
              timezone: input.timezone,
            },
            select: TENANT_SELECT,
          });
          await tx.tenantMembership.create({
            data: { tenantId: tenant.id, userId: ownerUserId, role: 'OWNER' },
          });
          return tenant;
        }),
      'slug',
    );
  }

  update(context: TenantContext, input: UpdateTenantSettingsInput): Promise<Tenant> {
    return this.prisma.tenant.update({
      where: { id: context.tenantId },
      data: input,
      select: TENANT_SELECT,
    });
  }

  async getEmailProfile(context: TenantContext): Promise<TenantEmailProfile> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: context.tenantId },
      select: { name: true, postalAddress: true, defaultLocale: true, branding: true },
    });
    return { ...tenant, branding: parseBranding(tenant.branding) };
  }

  async saveBranding(context: TenantContext, branding: TenantBranding): Promise<void> {
    await this.prisma.tenant.update({
      where: { id: context.tenantId },
      data: { branding: { ...branding } as Prisma.InputJsonObject },
    });
  }

  async stats(context: TenantContext): Promise<TenantStats> {
    const scoped = this.clients.forTenant(context.tenantId);
    const [contacts, activeContacts, lists, segments, members] = await Promise.all([
      scoped.contact.count(),
      scoped.contact.count({ where: { status: 'ACTIVE' } }),
      scoped.contactList.count(),
      scoped.segment.count(),
      scoped.tenantMembership.count(),
    ]);
    return { contacts, activeContacts, lists, segments, members };
  }
}
