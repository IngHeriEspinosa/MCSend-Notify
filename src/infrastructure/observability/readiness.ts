/**
 * Comprobaciones de disponibilidad (readiness) de las dependencias.
 *
 * La respuesta pública solo indica `up`/`down` por dependencia; el detalle del error se entrega
 * al callback `onFailure` para registrarlo, sin exponer hosts ni cadenas de conexión (OWASP A05).
 */

export interface HealthCheck {
  name: string;
  /** Si es crítica, su caída marca el servicio como `degraded`. */
  critical: boolean;
  check: (signal: AbortSignal) => Promise<void>;
}

export type CheckStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checkedAt: string;
  checks: Record<string, { status: CheckStatus; critical: boolean; latencyMs: number }>;
}

export interface RunHealthChecksOptions {
  timeoutMs?: number;
  onFailure?: (checkName: string, error: unknown) => void;
}

export class HealthCheckTimeoutError extends Error {
  constructor(checkName: string, timeoutMs: number) {
    super(`La comprobación "${checkName}" superó ${timeoutMs} ms`);
    this.name = 'HealthCheckTimeoutError';
  }
}

async function runWithTimeout(healthCheck: HealthCheck, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new HealthCheckTimeoutError(healthCheck.name, timeoutMs));
    }, timeoutMs);
  });
  try {
    await Promise.race([healthCheck.check(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runHealthChecks(
  checks: HealthCheck[],
  { timeoutMs = 3000, onFailure }: RunHealthChecksOptions = {},
): Promise<HealthReport> {
  const results = await Promise.all(
    checks.map(async (healthCheck) => {
      const startedAt = performance.now();
      let status: CheckStatus = 'up';
      try {
        await runWithTimeout(healthCheck, timeoutMs);
      } catch (error) {
        status = 'down';
        onFailure?.(healthCheck.name, error);
      }
      const latencyMs = Math.round(performance.now() - startedAt);
      return [healthCheck.name, { status, critical: healthCheck.critical, latencyMs }] as const;
    }),
  );

  const degraded = results.some(([, result]) => result.critical && result.status === 'down');
  return {
    status: degraded ? 'degraded' : 'ok',
    checkedAt: new Date().toISOString(),
    checks: Object.fromEntries(results),
  };
}

/** Comprobación HTTP genérica: la dependencia responde 2xx en la URL indicada. */
export function httpHealthCheck(name: string, url: string, critical = true): HealthCheck {
  return {
    name,
    critical,
    async check(signal) {
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`${name} respondió HTTP ${response.status}`);
      }
    },
  };
}
