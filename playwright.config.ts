/**
 * Pruebas E2E con Playwright y el Chrome del sistema (sin descargar navegadores).
 *
 * Requieren la app en marcha con los datos del seed (tenant `mcsupport` y el super-administrador):
 *   - producción local: `pnpm build && pnpm start` + worker, o el despliegue con Caddy
 *     (E2E_BASE_URL=https://mcsend.localhost, ver docs/DEPLOYMENT.md);
 *   - las credenciales se leen de E2E_EMAIL/E2E_PASSWORD o, si faltan, de SEED_ADMIN_* en `.env`;
 *   - con la CA interna de Caddy, E2E_TRUSTED_SPKI (huella SPKI de la CA) hace que Chrome confíe
 *     en ella solo durante las pruebas, sin tocar el almacén del sistema: el service worker exige
 *     un certificado de confianza.
 *
 *   pnpm test:e2e
 * Autor: Ing. Heri Espinosa
 */
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
import { chromeArgs } from './tests/e2e/support';

if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3020',
    channel: 'chrome',
    headless: true,
    locale: 'es-ES',
    viewport: { width: 1366, height: 900 },
    launchOptions: { args: chromeArgs() },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
