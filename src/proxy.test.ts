/**
 * Regresión del matcher del proxy: se compila con la misma función que usa Next.js, porque
 * Next.js elimina las barras invertidas del patrón y un escape mal puesto deja sin CSP
 * ni enrutado por idioma a todas las páginas salvo la raíz.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { config, loginRedirectFor } from './proxy';

interface CompiledMatcher {
  regexp: string;
}

const require = createRequire(import.meta.url);
const { getMiddlewareMatchers } = require('next/dist/build/analysis/get-page-static-info') as {
  getMiddlewareMatchers: (matcher: string[], nextConfig: object) => CompiledMatcher[];
};

function proxyRunsOn(pathname: string): boolean {
  return getMiddlewareMatchers(config.matcher, {}).some((matcher) =>
    new RegExp(matcher.regexp).test(pathname),
  );
}

describe('matcher del proxy', () => {
  it.each(['/', '/es', '/en', '/es/t/mcsupport/campaigns', '/en/login'])(
    'se ejecuta en la página %s',
    (pathname) => {
      expect(proxyRunsOn(pathname)).toBe(true);
    },
  );

  it.each([
    '/api/health',
    '/api/webhooks/email/token',
    '/trk/o/token',
    '/_next/static/chunk.js',
    '/brand/logo-color.png',
    '/icon.png',
  ])('no se ejecuta en %s', (pathname) => {
    expect(proxyRunsOn(pathname)).toBe(false);
  });
});

describe('loginRedirectFor', () => {
  it('redirige las secciones privadas sin sesión conservando el destino', () => {
    expect(loginRedirectFor('/es/t/mcsupport/contacts', false)).toBe(
      '/es/login?callbackUrl=%2Fes%2Ft%2Fmcsupport%2Fcontacts',
    );
    expect(loginRedirectFor('/en/select-tenant', false)).toBe(
      '/en/login?callbackUrl=%2Fen%2Fselect-tenant',
    );
  });

  it('no redirige páginas públicas ni peticiones con sesión', () => {
    expect(loginRedirectFor('/es', false)).toBeNull();
    expect(loginRedirectFor('/es/login', false)).toBeNull();
    expect(loginRedirectFor('/es/invite/abc', false)).toBeNull();
    expect(loginRedirectFor('/es/t/mcsupport', true)).toBeNull();
  });
});
