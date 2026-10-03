/**
 * Empaqueta el worker (dist/worker/index.mjs) y la CLI de rotación de claves
 * (dist/worker/rotate-secrets.mjs) como módulos ESM con esbuild.
 * El código propio (alias `@/`) se incluye en el bundle; las dependencias de node_modules
 * quedan externas y se instalan en la imagen con `pnpm install --prod`.
 */
import { build } from 'esbuild';

await build({
  entryPoints: {
    index: 'src/worker/index.ts',
    'rotate-secrets': 'src/worker/cli/rotate-secrets.ts',
  },
  outdir: 'dist/worker',
  outExtension: { '.js': '.mjs' },
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
