import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, generateNonce } from './content-security-policy';

describe('buildContentSecurityPolicy', () => {
  it('incluye el nonce y bloquea objetos y el embebido en iframes ajenos', () => {
    const policy = buildContentSecurityPolicy({ nonce: 'abc123', isDevelopment: false });

    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it("solo permite 'unsafe-eval' en desarrollo", () => {
    expect(buildContentSecurityPolicy({ nonce: 'n', isDevelopment: true })).toContain(
      "'unsafe-eval'",
    );
    expect(buildContentSecurityPolicy({ nonce: 'n', isDevelopment: false })).not.toContain(
      "'unsafe-eval'",
    );
  });
});

describe('generateNonce', () => {
  it('genera valores base64 distintos en cada llamada', () => {
    const first = generateNonce();
    const second = generateNonce();

    expect(first).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(first).not.toBe(second);
  });
});
