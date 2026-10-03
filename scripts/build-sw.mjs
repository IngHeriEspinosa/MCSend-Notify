/**
 * Compila el service worker (src/sw/sw.ts) con esbuild e inyecta el manifiesto de precarga de
 * Serwist en public/sw.js. Se ejecuta después de `next build`, porque la precarga referencia los
 * archivos con hash de .next/static. Autor: Ing. Heri Espinosa
 */
import { injectManifest } from '@serwist/build';
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

const temp = '.next/sw.bundle.js';
const revision = readFileSync('.next/BUILD_ID', 'utf8').trim();

await build({
  entryPoints: ['src/sw/sw.ts'],
  outfile: temp,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  tsconfig: 'src/sw/tsconfig.json',
  logLevel: 'warning',
});

const { count, size, warnings } = await injectManifest({
  swSrc: temp,
  swDest: 'public/sw.js',
  globDirectory: '.next',
  globPatterns: ['static/css/**/*.css', 'static/media/**/*.{woff,woff2}'],
  modifyURLPrefix: { 'static/': '/_next/static/' },
  dontCacheBustURLsMatching: /^\/_next\/static\//,
  additionalPrecacheEntries: [
    { url: '/es/offline', revision },
    { url: '/en/offline', revision },
    { url: '/icons/icon-192.png', revision },
  ],
  maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
});
rmSync(temp, { force: true });
for (const warning of warnings) console.warn(warning);
console.log(`Service worker: ${count} archivos precargados (${(size / 1024).toFixed(0)} KB)`);
