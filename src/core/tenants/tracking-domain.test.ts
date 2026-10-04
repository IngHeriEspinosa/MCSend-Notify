import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import { ownerContext } from '@tests/fakes/sending.fakes';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  ManageTrackingDomainUseCase,
  ReverifyTrackingDomainsUseCase,
  TrackingDomainTlsPolicy,
  trackingDomainSchema,
  type CnameResolver,
  type TrackingDomainError,
  type TrackingDomainRepository,
  type TrackingDomainState,
} from './tracking-domain';

const PLATFORM = 'mcsend.multicomputos.com';
const OTHER_TENANT = '99999999-9999-7999-8999-999999999999';

class InMemoryTrackingDomains implements TrackingDomainRepository {
  readonly states = new Map<string, TrackingDomainState & { slug: string }>();

  async get(context: TenantContext) {
    const state = this.states.get(context.tenantId);
    return state ? { ...state } : null;
  }

  async set(context: TenantContext, domain: string | null) {
    if (domain === null) {
      this.states.delete(context.tenantId);
      return true;
    }
    for (const [tenantId, state] of this.states) {
      if (state.domain === domain && tenantId !== context.tenantId) return false;
    }
    this.states.set(context.tenantId, {
      domain,
      verifiedAt: null,
      checkedAt: null,
      error: null,
      slug: context.tenantSlug,
    });
    return true;
  }

  async recordCheck(
    context: TenantContext,
    result: { verified: boolean; at: Date; error: TrackingDomainError | null },
  ) {
    const state = this.states.get(context.tenantId);
    if (!state) return;
    this.states.set(context.tenantId, {
      ...state,
      verifiedAt: result.verified ? (state.verifiedAt ?? result.at) : null,
      checkedAt: result.at,
      error: result.error,
    });
  }

  async listConfigured() {
    return [...this.states].map(([tenantId, state]) => ({
      tenantId,
      tenantSlug: state.slug,
      domain: state.domain,
    }));
  }

  async isVerified(domain: string) {
    return [...this.states.values()].some((s) => s.domain === domain && s.verifiedAt !== null);
  }
}

class FakeDns implements CnameResolver {
  readonly records = new Map<string, string[] | Error>();
  async resolveCname(domain: string) {
    const record = this.records.get(domain);
    if (record instanceof Error) throw record;
    return record ?? [];
  }
}

let domains: InMemoryTrackingDomains;
let dns: FakeDns;
let audit: RecordingAuditLogger;
let clock: FakeClock;

const manage = () =>
  new ManageTrackingDomainUseCase({ domains, dns, audit, clock, platformHost: PLATFORM });

beforeEach(() => {
  domains = new InMemoryTrackingDomains();
  dns = new FakeDns();
  audit = new RecordingAuditLogger();
  clock = new FakeClock();
});

describe('validación del dominio', () => {
  const schema = trackingDomainSchema(PLATFORM);

  it('normaliza mayúsculas, espacios y el punto final', () => {
    expect(schema.parse('  Clic.MCSupport.com. ')).toBe('clic.mcsupport.com');
  });

  it('rechaza IP, nombres locales, URL y el dominio de la plataforma o sus subdominios', () => {
    for (const value of [
      '192.168.1.10',
      'localhost',
      'clic.localhost',
      'servidor.local',
      'https://clic.mcsupport.com',
      'clic.mcsupport.com/trk',
      'sin-punto',
      PLATFORM,
      `clic.${PLATFORM}`,
      '-mal.ejemplo.com',
    ]) {
      expect(schema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('ManageTrackingDomainUseCase', () => {
  it('configura y verifica en el acto cuando el CNAME apunta a la plataforma', async () => {
    dns.records.set('clic.mcsupport.com', [`${PLATFORM}.`]);
    const view = await manage().set(ownerContext, 'clic.mcsupport.com');
    expect(view).toMatchObject({
      domain: 'clic.mcsupport.com',
      verifiedAt: clock.now(),
      error: null,
      cnameTarget: PLATFORM,
    });
    expect(await domains.isVerified('clic.mcsupport.com')).toBe(true);
    expect(audit.entries.map((entry) => entry.action)).toEqual([
      'tracking_domain.set',
      'tracking_domain.checked',
    ]);
  });

  it('sin CNAME, con otro destino o con error de DNS queda sin verificar y con el motivo', async () => {
    expect((await manage().set(ownerContext, 'clic.mcsupport.com')).error).toBe('CNAME_MISSING');
    dns.records.set('clic.mcsupport.com', ['otro.example.com']);
    expect((await manage().verify(ownerContext)).error).toBe('CNAME_MISMATCH');
    dns.records.set('clic.mcsupport.com', new Error('SERVFAIL'));
    expect(await manage().verify(ownerContext)).toMatchObject({
      verifiedAt: null,
      error: 'DNS_ERROR',
    });
  });

  it('un dominio no puede pertenecer a dos aplicaciones', async () => {
    await domains.set({ ...ownerContext, tenantId: OTHER_TENANT }, 'clic.mcsupport.com');
    await expect(manage().set(ownerContext, 'clic.mcsupport.com')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'TRACKING_DOMAIN_TAKEN' },
    });
    await expect(manage().set(ownerContext, 'no es un dominio')).rejects.toMatchObject({
      details: { reason: 'TRACKING_DOMAIN_INVALID' },
    });
  });

  it('solo OWNER/ADMIN lo cambian; quitarlo deja de usarlo', async () => {
    const editor: TenantContext = {
      ...ownerContext,
      actor: { type: 'user', userId: 'e', role: 'EDITOR', isPlatformAdmin: false },
    };
    await expect(manage().set(editor, 'clic.mcsupport.com')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    dns.records.set('clic.mcsupport.com', [PLATFORM]);
    await manage().set(ownerContext, 'clic.mcsupport.com');
    await manage().remove(ownerContext);
    expect(await manage().get(ownerContext)).toBeNull();
    expect(await domains.isVerified('clic.mcsupport.com')).toBe(false);
  });
});

describe('ReverifyTrackingDomainsUseCase', () => {
  it('retira la verificación si el CNAME desaparece y la mantiene si sigue', async () => {
    dns.records.set('clic.mcsupport.com', [PLATFORM]);
    dns.records.set('track.mclog.com', [PLATFORM]);
    await manage().set(ownerContext, 'clic.mcsupport.com');
    const other = { ...ownerContext, tenantId: OTHER_TENANT, tenantSlug: 'mclog' };
    await manage().set(other, 'track.mclog.com');

    dns.records.delete('track.mclog.com');
    clock.advance(86_400_000);
    const result = await new ReverifyTrackingDomainsUseCase({
      domains,
      dns,
      clock,
      platformHost: PLATFORM,
    }).execute();

    expect(result).toEqual({ checked: 2, verified: 1 });
    expect(await domains.isVerified('clic.mcsupport.com')).toBe(true);
    expect(await domains.get(other)).toMatchObject({ verifiedAt: null, error: 'CNAME_MISSING' });
  });
});

describe('TrackingDomainTlsPolicy', () => {
  it('solo autoriza certificados para dominios verificados', async () => {
    dns.records.set('clic.mcsupport.com', [PLATFORM]);
    await manage().set(ownerContext, 'clic.mcsupport.com');
    await domains.set({ ...ownerContext, tenantId: OTHER_TENANT }, 'sin-verificar.mclog.com');
    const policy = new TrackingDomainTlsPolicy({ domains });
    expect(await policy.isAllowed('CLIC.mcsupport.com.')).toBe(true);
    expect(await policy.isAllowed('sin-verificar.mclog.com')).toBe(false);
    expect(await policy.isAllowed('evil.example.com')).toBe(false);
    expect(await policy.isAllowed('../etc/passwd')).toBe(false);
  });
});
