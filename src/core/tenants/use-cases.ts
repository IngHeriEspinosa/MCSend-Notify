/** Casos de uso de tenants: acceso, alta por la plataforma, configuración y estadísticas. */
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import type { MembershipRole, PlatformRole } from '@/core/identity/roles';
import { DomainError } from '@/core/shared/domain-error';
import type { RequestMeta, TenantContext } from '@/core/shared/tenant-context';
import type {
  CreateTenantData,
  Tenant,
  TenantRepository,
  TenantStats,
  UpdateTenantSettingsInput,
} from './tenant';

export interface SessionUser {
  id: string;
  platformRole: PlatformRole;
}

/**
 * Resuelve el contexto de tenant para un usuario. Un SUPER_ADMIN accede a cualquier tenant
 * con privilegios de OWNER (soporte); cada acción queda auditada con su usuario.
 * Para no revelar qué tenants existen, la ausencia de acceso devuelve NOT_FOUND.
 */
export class ResolveTenantAccessUseCase {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(
    user: SessionUser,
    slug: string,
    requestMeta?: RequestMeta,
  ): Promise<{ tenant: Tenant; context: TenantContext }> {
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new DomainError('NOT_FOUND', 'Tenant inexistente o sin acceso');
    }
    const isPlatformAdmin = user.platformRole === 'SUPER_ADMIN';
    const role =
      (await this.tenants.findMembershipRole(tenant.id, user.id)) ??
      (isPlatformAdmin ? 'OWNER' : null);
    if (!role) {
      throw new DomainError('NOT_FOUND', 'Tenant inexistente o sin acceso');
    }
    return {
      tenant,
      context: {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        actor: { type: 'user', userId: user.id, role, isPlatformAdmin },
        requestMeta,
      },
    };
  }
}

export class CreateTenantUseCase {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(user: SessionUser, input: CreateTenantData): Promise<Tenant> {
    if (user.platformRole !== 'SUPER_ADMIN') {
      throw new DomainError('FORBIDDEN', 'Solo un administrador de plataforma crea tenants');
    }
    if (await this.tenants.findBySlug(input.slug)) {
      throw new DomainError('CONFLICT', 'El identificador ya está en uso', { field: 'slug' });
    }
    const tenant = await this.tenants.createWithOwner(input, user.id);
    await this.audit.record(null, {
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: { slug: tenant.slug, createdBy: user.id },
    });
    return tenant;
  }
}

export class UpdateTenantSettingsUseCase {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly audit: AuditLogger,
  ) {}

  async execute(context: TenantContext, input: UpdateTenantSettingsInput): Promise<Tenant> {
    assertCan(context, 'tenant:update');
    const tenant = await this.tenants.update(context, input);
    await this.audit.record(context, {
      action: 'tenant.updated',
      entityType: 'tenant',
      entityId: tenant.id,
      metadata: { fields: Object.keys(input) },
    });
    return tenant;
  }
}

export class GetTenantStatsUseCase {
  constructor(private readonly tenants: TenantRepository) {}

  execute(context: TenantContext): Promise<TenantStats> {
    assertCan(context, 'tenant:read');
    return this.tenants.stats(context);
  }
}

/** Tenants accesibles para el usuario. Un SUPER_ADMIN ve todos (con privilegios de OWNER). */
export class ListUserTenantsUseCase {
  constructor(private readonly tenants: TenantRepository) {}

  async execute(user: SessionUser): Promise<Array<{ tenant: Tenant; role: MembershipRole }>> {
    const memberships = await this.tenants.listForUser(user.id);
    if (user.platformRole !== 'SUPER_ADMIN') return memberships;
    const roleByTenant = new Map(memberships.map((item) => [item.tenant.id, item.role]));
    const all = await this.tenants.listAll();
    return all
      .filter((tenant) => tenant.status === 'ACTIVE')
      .map((tenant) => ({ tenant, role: roleByTenant.get(tenant.id) ?? 'OWNER' }));
  }
}
