import { describe, expect, it, vi } from 'vitest';
import { HealthCheckTimeoutError, runHealthChecks, type HealthCheck } from './readiness';

const passing = (name: string, critical = true): HealthCheck => ({
  name,
  critical,
  check: async () => undefined,
});

const failing = (name: string, critical = true): HealthCheck => ({
  name,
  critical,
  check: async () => {
    throw new Error(`postgresql://user:secret@db/${name} no responde`);
  },
});

describe('runHealthChecks', () => {
  it('informa ok cuando todas las dependencias responden', async () => {
    const report = await runHealthChecks([passing('database'), passing('redis')]);

    expect(report.status).toBe('ok');
    expect(report.checks.database?.status).toBe('up');
  });

  it('marca degraded si cae una dependencia crítica', async () => {
    const report = await runHealthChecks([passing('redis'), failing('database')]);

    expect(report.status).toBe('degraded');
    expect(report.checks.database?.status).toBe('down');
  });

  it('una dependencia no crítica caída no degrada el servicio', async () => {
    const report = await runHealthChecks([passing('database'), failing('worker', false)]);

    expect(report.status).toBe('ok');
    expect(report.checks.worker?.status).toBe('down');
  });

  it('no expone el detalle del error en el informe y lo entrega al callback', async () => {
    const onFailure = vi.fn();
    const report = await runHealthChecks([failing('database')], { onFailure });

    expect(JSON.stringify(report)).not.toContain('secret');
    expect(onFailure).toHaveBeenCalledWith('database', expect.any(Error));
  });

  it('corta las comprobaciones que superan el tiempo máximo', async () => {
    const onFailure = vi.fn();
    const slow: HealthCheck = {
      name: 'gotenberg',
      critical: true,
      check: (signal) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 1000);
          signal.addEventListener('abort', () => clearTimeout(timer));
        }),
    };

    const report = await runHealthChecks([slow], { timeoutMs: 20, onFailure });

    expect(report.checks.gotenberg?.status).toBe('down');
    expect(onFailure.mock.calls[0]?.[1]).toBeInstanceOf(HealthCheckTimeoutError);
  });
});
