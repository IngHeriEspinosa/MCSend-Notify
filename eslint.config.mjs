/**
 * ESLint (flat config) — Ing. Heri Espinosa
 * Además de las reglas de Next.js y TypeScript, hace cumplir los límites de la arquitectura
 * hexagonal: el dominio (core) no conoce frameworks ni infraestructura.
 */
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

const FRAMEWORK_IMPORTS = [
  {
    group: ['next', 'next/*', 'next-intl', 'next-intl/*'],
    message: 'La capa no debe depender de Next.js.',
  },
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    message: 'La capa no debe depender de React.',
  },
  { group: ['@mui/*', '@emotion/*'], message: 'La capa no debe depender de la UI.' },
  { group: ['server-only'], message: 'server-only solo se usa en src/app/_server.' },
];

const PRESENTATION_IMPORTS = [
  {
    group: ['@/app', '@/app/*', '**/app/**'],
    message: 'No se importa la capa de presentación (src/app).',
  },
  { group: ['@/components', '@/components/*'], message: 'No se importan componentes de UI.' },
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([
    '.next/**',
    'dist/**',
    'coverage/**',
    'node_modules/**',
    'next-env.d.ts',
    'src/infrastructure/persistence/prisma/generated/**',
    'desing/**',
  ]),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...FRAMEWORK_IMPORTS,
            ...PRESENTATION_IMPORTS,
            {
              group: ['@/infrastructure', '@/infrastructure/*', '**/infrastructure/**'],
              message: 'El dominio depende de puertos, no de infraestructura.',
            },
            { group: ['@/worker', '@/worker/*'], message: 'El dominio no conoce el worker.' },
            {
              group: ['@/common/config', '@/common/config/*'],
              message: 'El dominio no lee configuración de entorno.',
            },
            {
              group: ['@prisma/*', 'bullmq', 'ioredis', 'pino', 'pg'],
              message: 'El dominio no depende de librerías de infraestructura.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/infrastructure/**/*.{ts,tsx}', 'src/worker/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...FRAMEWORK_IMPORTS, ...PRESENTATION_IMPORTS] },
      ],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/infrastructure', '@/infrastructure/*'],
              message: 'La UI usa Server Actions o props, no infraestructura.',
            },
            {
              group: ['@/worker', '@/worker/*', '@prisma/*', 'bullmq', 'ioredis'],
              message: 'La UI no depende de infraestructura.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'prisma/**/*.ts', '*.config.{ts,mjs}'],
    rules: { 'no-console': 'off' },
  },
]);
