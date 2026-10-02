/**
 * Vitest con dos proyectos:
 * - unit: rápido, sin servicios externos (core, infrastructure con dobles, utilidades).
 * - integration: contra PostgreSQL/Redis reales de Docker (tests/integration).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const testsDir = fileURLToPath(new URL('./tests', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@tests': testsDir, '@': srcDir },
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
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 90_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
