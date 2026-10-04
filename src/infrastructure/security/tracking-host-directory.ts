/**
 * Directorio en memoria de los dominios de seguimiento verificados (tenant → dominio).
 *
 * Los firmadores de enlaces son síncronos y se llaman por cada destinatario: consultar la base de
 * datos en cada enlace no es viable. El directorio carga una instantánea al arrancar, la refresca
 * cada minuto y al momento tras un cambio en este proceso. Si un refresco falla, se mantiene la
 * instantánea anterior; sin instantánea se usa el dominio de la plataforma (siempre válido).
 */

export interface VerifiedDomainSource {
  verifiedDomains(): Promise<Array<{ tenantId: string; domain: string }>>;
}

/** Lo que necesitan los firmadores de enlaces. */
export interface TrackingHosts {
  /** URL base de seguimiento de un tenant (dominio propio verificado o el de la plataforma). */
  baseUrlFor(tenantId: string): string;
  /** Indica si el host es el de la plataforma o un dominio de seguimiento verificado. */
  isTrackingHost(host: string): boolean;
}

const REFRESH_MS = 60_000;

export class TrackingHostDirectory implements TrackingHosts {
  private readonly platformBaseUrl: string;
  private readonly platformHost: string;
  private byTenant = new Map<string, string>();
  private hosts = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly source: VerifiedDomainSource,
    platformBaseUrl: string,
    private readonly onError: (error: unknown) => void = () => {},
  ) {
    this.platformBaseUrl = platformBaseUrl.replace(/\/+$/, '');
    this.platformHost = new URL(this.platformBaseUrl).host.toLowerCase();
  }

  baseUrlFor(tenantId: string): string {
    const domain = this.byTenant.get(tenantId);
    return domain ? `https://${domain}` : this.platformBaseUrl;
  }

  isTrackingHost(host: string): boolean {
    const normalized = host.toLowerCase();
    return normalized === this.platformHost || this.hosts.has(normalized);
  }

  async refresh(): Promise<void> {
    try {
      const rows = await this.source.verifiedDomains();
      this.byTenant = new Map(rows.map((row) => [row.tenantId, row.domain]));
      this.hosts = new Set(rows.map((row) => row.domain));
    } catch (error) {
      this.onError(error);
    }
  }

  /** Refresco periódico; el temporizador no impide que el proceso termine. */
  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
