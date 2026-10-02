/**
 * Vitest con dos proyectos:
 * - unit: rápido, sin servicios externos (core, infrastructure con dobles, utilidades).
 * - integration: contra PostgreSQL/Redis reales de Docker (tests/integration).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': srcDir },
  },
  test: {
    // next-intl importa `next/server` sin extensión; Vitest debe resolverlo con Vite, no con Node.
    server: { deps: { inline: ['next-intl'] } },
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/infrastructure/**', 'src/common/**', 'src/worker/**'],
      exclude: ['src/infrastructure/persistence/prisma/generated/**', '**/*.test.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.int.test.ts'],
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
