/**
 * Empaqueta el worker en un único módulo ESM (dist/worker/index.mjs) con esbuild.
 * El código propio (alias `@/`) se incluye en el bundle; las dependencias de node_modules
 * quedan externas y se instalan en la imagen con `pnpm install --prod`.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/worker/index.ts'],
  outfile: 'dist/worker/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  sourcemap: true,
  logLevel: 'info',
  banner: {
    // Algunas dependencias CommonJS usan `require` dentro de módulos ESM.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
