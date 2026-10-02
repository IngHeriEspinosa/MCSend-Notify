import { describe, expect, it } from 'vitest';
import { PROVIDER_DEFAULTS, providerInputSchema } from './provider-config';

const graph = (rateLimitPerSecond: number) => ({
  name: 'Buzón de novedades',
  kind: 'MICROSOFT_GRAPH',
  settings: {
    azureTenantId: 'multicomputos.onmicrosoft.com',
    clientId: '0f9a3c1e-7b2d-4e8f-9a1b-2c3d4e5f6a7b',
  },
  credentials: { clientSecret: 'secreto-de-cliente' },
  rateLimitPerSecond,
  maxPerDay: 10_000,
  isDefault: false,
});

describe('límites de los proveedores', () => {
  it('admite ritmos con decimales para respetar Microsoft 365 (30 por minuto)', () => {
    expect(PROVIDER_DEFAULTS.MICROSOFT_GRAPH.rateLimitPerSecond * 60).toBeLessThanOrEqual(30);
    expect(providerInputSchema.safeParse(graph(0.5)).success).toBe(true);
  });

  it('rechaza ritmos nulos, negativos o desproporcionados', () => {
    for (const rate of [0, -1, 0.05, 501]) {
      expect(providerInputSchema.safeParse(graph(rate)).success).toBe(false);
    }
  });
});
