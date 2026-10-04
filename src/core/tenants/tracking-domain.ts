/**
 * Dominio de seguimiento propio por aplicación (p. ej. `clic.mcsupport.com`).
 *
 * La aplicación crea un CNAME de su dominio hacia el de la plataforma. Mientras el CNAME no se
 * verifique, los correos usan el dominio de la plataforma; una vez verificado, los enlaces de
 * seguimiento (apertura, clic, baja, miniaturas, descargas y logotipo) usan el dominio propio.
 * Un barrido diario lo revalida y, si el CNAME desaparece, se vuelve al de la plataforma.
 *
 * En los dominios propios solo se sirve `/trk/*` (Caddy); el centro de preferencias y el resto
 * de la aplicación siguen en el dominio de la plataforma (ADR 0016).
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import { systemContext, type TenantContext } from '@/core/shared/tenant-context';

export const TRACKING_DOMAIN_ERRORS = ['CNAME_MISSING', 'CNAME_MISMATCH', 'DNS_ERROR'] as const;
export type TrackingDomainError = (typeof TRACKING_DOMAIN_ERRORS)[number];

/** Nombre de host público: etiquetas LDH, al menos dos y TLD alfabético. */
const HOSTNAME =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

/** Valida el dominio propuesto frente al de la plataforma (`platformHost`). */
export function trackingDomainSchema(platformHost: string) {
  const platform = normalizeHost(platformHost);
  return z
    .string()
    .transform(normalizeHost)
    .pipe(
      z
        .string()
        .regex(HOSTNAME, 'INVALID_DOMAIN')
        .refine(
          (host) => !host.endsWith('.localhost') && !host.endsWith('.local'),
          'INVALID_DOMAIN',
        )
        .refine((host) => host !== platform && !host.endsWith(`.${platform}`), 'PLATFORM_DOMAIN'),
    );
}

export interface TrackingDomainState {
  domain: string;
  verifiedAt: Date | null;
  checkedAt: Date | null;
  error: TrackingDomainError | null;
}

export interface TrackingDomainView extends TrackingDomainState {
  /** Destino que debe tener el CNAME (el dominio de la plataforma). */
  cnameTarget: string;
}

// ---------------------------------------------------------------------------
// Puertos
// ---------------------------------------------------------------------------

export interface TrackingDomainRepository {
  get(context: TenantContext): Promise<TrackingDomainState | null>;
  /**
   * Fija (o quita, con `null`) el dominio y borra su verificación. Devuelve `false` si otro
   * tenant ya lo usa.
   */
  set(context: TenantContext, domain: string | null): Promise<boolean>;
  recordCheck(
    context: TenantContext,
    result: { verified: boolean; at: Date; error: TrackingDomainError | null },
  ): Promise<void>;
  /** Dominios configurados de todos los tenants (barrido diario; sin ámbito de tenant). */
  listConfigured(): Promise<Array<{ tenantId: string; tenantSlug: string; domain: string }>>;
  /** Indica si el dominio pertenece a algún tenant y está verificado (TLS bajo demanda). */
  isVerified(domain: string): Promise<boolean>;
}

export interface CnameResolver {
  /** Destinos CNAME del nombre; lista vacía si no tiene. Lanza si el DNS falla. */
  resolveCname(domain: string): Promise<string[]>;
}

export interface TrackingDomainDeps {
  domains: TrackingDomainRepository;
  dns: CnameResolver;
  audit: AuditLogger;
  clock: Clock;
  /** Host de la plataforma (el de `APP_URL`): destino obligatorio del CNAME. */
  platformHost: string;
}

/** Comprueba el CNAME de un dominio contra el host de la plataforma. */
export async function checkTrackingCname(
  dns: CnameResolver,
  domain: string,
  platformHost: string,
): Promise<{ verified: boolean; error: TrackingDomainError | null }> {
  let targets: string[];
  try {
    targets = await dns.resolveCname(domain);
  } catch {
    return { verified: false, error: 'DNS_ERROR' };
  }
  if (targets.length === 0) return { verified: false, error: 'CNAME_MISSING' };
  const platform = normalizeHost(platformHost);
  return targets.some((target) => normalizeHost(target) === platform)
    ? { verified: true, error: null }
    : { verified: false, error: 'CNAME_MISMATCH' };
}

export class ManageTrackingDomainUseCase {
  constructor(private readonly deps: TrackingDomainDeps) {}

  async get(context: TenantContext): Promise<TrackingDomainView | null> {
    assertCan(context, 'tenant:read');
    const state = await this.deps.domains.get(context);
    return state ? { ...state, cnameTarget: normalizeHost(this.deps.platformHost) } : null;
  }

  /** Configura el dominio (queda sin verificar) y lo comprueba en el acto. */
  async set(context: TenantContext, rawDomain: string): Promise<TrackingDomainView> {
    assertCan(context, 'tenant:update');
    const parsed = trackingDomainSchema(this.deps.platformHost).safeParse(rawDomain);
    if (!parsed.success) {
      throw new DomainError('VALIDATION', 'Dominio no válido', {
        reason: 'TRACKING_DOMAIN_INVALID',
        field: 'domain',
      });
    }
    if (!(await this.deps.domains.set(context, parsed.data))) {
      throw new DomainError('CONFLICT', 'El dominio ya lo usa otra aplicación', {
        reason: 'TRACKING_DOMAIN_TAKEN',
        field: 'domain',
      });
    }
    await this.audit(context, 'tracking_domain.set', { domain: parsed.data });
    return this.verify(context);
  }

  async verify(context: TenantContext): Promise<TrackingDomainView> {
    assertCan(context, 'tenant:update');
    const state = await this.deps.domains.get(context);
    if (!state) throw new DomainError('NOT_FOUND', 'Sin dominio de seguimiento');
    const result = await checkTrackingCname(this.deps.dns, state.domain, this.deps.platformHost);
    const at = this.deps.clock.now();
    await this.deps.domains.recordCheck(context, { ...result, at });
    await this.audit(context, 'tracking_domain.checked', {
      domain: state.domain,
      verified: result.verified,
      error: result.error,
    });
    return {
      domain: state.domain,
      verifiedAt: result.verified ? (state.verifiedAt ?? at) : null,
      checkedAt: at,
      error: result.error,
      cnameTarget: normalizeHost(this.deps.platformHost),
    };
  }

  async remove(context: TenantContext): Promise<void> {
    assertCan(context, 'tenant:update');
    const state = await this.deps.domains.get(context);
    if (!state) return;
    await this.deps.domains.set(context, null);
    await this.audit(context, 'tracking_domain.removed', { domain: state.domain });
  }

  private audit(context: TenantContext, action: string, metadata: Record<string, unknown>) {
    return this.deps.audit.record(context, { action, entityType: 'tenant', metadata });
  }
}

/** Barrido diario: revalida el CNAME de todos los dominios configurados. */
export class ReverifyTrackingDomainsUseCase {
  constructor(private readonly deps: Omit<TrackingDomainDeps, 'audit'>) {}

  async execute(): Promise<{ checked: number; verified: number }> {
    const configured = await this.deps.domains.listConfigured();
    let verified = 0;
    for (const item of configured) {
      const result = await checkTrackingCname(this.deps.dns, item.domain, this.deps.platformHost);
      if (result.verified) verified += 1;
      const context = systemContext(item.tenantId, item.tenantSlug, 'tracking-domains-verify');
      await this.deps.domains.recordCheck(context, { ...result, at: this.deps.clock.now() });
    }
    return { checked: configured.length, verified };
  }
}

/**
 * TLS bajo demanda: Caddy pregunta antes de emitir un certificado para un host desconocido. Solo
 * se autoriza un dominio verificado de un tenant activo (evita emisiones abusivas a terceros).
 */
export class TrackingDomainTlsPolicy {
  constructor(private readonly deps: { domains: Pick<TrackingDomainRepository, 'isVerified'> }) {}

  async isAllowed(rawDomain: string): Promise<boolean> {
    const host = normalizeHost(rawDomain);
    if (!HOSTNAME.test(host)) return false;
    return this.deps.domains.isVerified(host);
  }
}
