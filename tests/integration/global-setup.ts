/**
 * Preparación de los tests de integración: aplica las migraciones a la base de datos efímera
 * de tests (servicio `postgres-test`, en memoria). Nunca apunta a la base de desarrollo.
 * Redis se toma de `TEST_REDIS_URL` o, si no existe, del `REDIS_URL` local (`.env`); los tests
 * solo usan claves aleatorias, por lo que no interfieren con los datos de desarrollo.
 *
 *   docker compose --profile test up -d --wait postgres-test
 *   pnpm test:int
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://mcsn_test:mcsn_test@localhost:5453/mc_send_notify_test';

export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  if (!url.includes('_test')) {
    throw new Error('TEST_DATABASE_URL debe apuntar a una base de datos de tests (*_test).');
  }
  process.env.TEST_DATABASE_URL = url;
  if (!process.env.TEST_REDIS_URL) {
    if (!process.env.REDIS_URL && existsSync('.env')) process.loadEnvFile('.env');
    if (process.env.REDIS_URL) process.env.TEST_REDIS_URL = process.env.REDIS_URL;
  }
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
