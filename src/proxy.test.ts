/**
 * Regresión del matcher del proxy: se compila con la misma función que usa Next.js, porque
 * Next.js elimina las barras invertidas del patrón y un escape mal puesto deja sin CSP
 * ni enrutado por idioma a todas las páginas salvo la raíz.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { config } from './proxy';

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
