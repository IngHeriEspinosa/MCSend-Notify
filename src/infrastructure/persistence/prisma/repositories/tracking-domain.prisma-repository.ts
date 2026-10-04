/**
 * Dominio de seguimiento de cada tenant (columnas de `tenants`). El dominio es único entre
 * tenants: la restricción de la base de datos resuelve las carreras entre dos altas simultáneas.
 */
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  TRACKING_DOMAIN_ERRORS,
  type TrackingDomainError,
  type TrackingDomainRepository,
  type TrackingDomainState,
} from '@/core/tenants/tracking-domain';
import type { PrismaClient } from '../generated/client';
import { isUniqueViolation } from '../prisma-errors';

const isTrackingError = (value: string | null): value is TrackingDomainError =>
  TRACKING_DOMAIN_ERRORS.some((code) => code === value);

export class PrismaTrackingDomainRepository implements TrackingDomainRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(context: TenantContext): Promise<TrackingDomainState | null> {
    const row = await this.prisma.tenant.findUnique({
      where: { id: context.tenantId },
      select: {
        trackingDomain: true,
        trackingDomainVerifiedAt: true,
        trackingDomainCheckedAt: true,
        trackingDomainError: true,
      },
    });
    if (!row?.trackingDomain) return null;
    return {
      domain: row.trackingDomain,
      verifiedAt: row.trackingDomainVerifiedAt,
      checkedAt: row.trackingDomainCheckedAt,
      error: isTrackingError(row.trackingDomainError) ? row.trackingDomainError : null,
    };
  }

  async set(context: TenantContext, domain: string | null): Promise<boolean> {
    try {
      await this.prisma.tenant.update({
        where: { id: context.tenantId },
        data: {
          trackingDomain: domain,
          trackingDomainVerifiedAt: null,
          trackingDomainCheckedAt: null,
          trackingDomainError: null,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async recordCheck(
    context: TenantContext,
    result: { verified: boolean; at: Date; error: TrackingDomainError | null },
  ): Promise<void> {
    const current = await this.prisma.tenant.findUnique({
      where: { id: context.tenantId },
      select: { trackingDomainVerifiedAt: true },
    });
    await this.prisma.tenant.updateMany({
      where: { id: context.tenantId, trackingDomain: { not: null } },
      data: {
        // Conserva la fecha de la primera verificación mientras siga siendo válida.
        trackingDomainVerifiedAt: result.verified
          ? (current?.trackingDomainVerifiedAt ?? result.at)
          : null,
        trackingDomainCheckedAt: result.at,
        trackingDomainError: result.error,
      },
    });
  }

  async listConfigured() {
    const rows = await this.prisma.tenant.findMany({
      where: { trackingDomain: { not: null }, status: 'ACTIVE' },
      select: { id: true, slug: true, trackingDomain: true },
    });
    return rows.flatMap((row) =>
      row.trackingDomain
        ? [{ tenantId: row.id, tenantSlug: row.slug, domain: row.trackingDomain }]
        : [],
    );
  }

  async isVerified(domain: string): Promise<boolean> {
    const count = await this.prisma.tenant.count({
      where: { trackingDomain: domain, trackingDomainVerifiedAt: { not: null }, status: 'ACTIVE' },
    });
    return count > 0;
  }

  /** Dominios verificados de los tenants activos (para el directorio en memoria). */
  async verifiedDomains(): Promise<Array<{ tenantId: string; domain: string }>> {
    const rows = await this.prisma.tenant.findMany({
      where: {
        trackingDomain: { not: null },
        trackingDomainVerifiedAt: { not: null },
        status: 'ACTIVE',
      },
      select: { id: true, trackingDomain: true },
    });
    return rows.flatMap((row) =>
      row.trackingDomain ? [{ tenantId: row.id, domain: row.trackingDomain }] : [],
    );
  }
}
