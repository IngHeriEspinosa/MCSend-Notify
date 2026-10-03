/**
 * Inicia sesión una vez con el super-administrador del seed y guarda la sesión para las pruebas.
 * Las credenciales nunca se imprimen.
 */
import { chromium, type FullConfig } from '@playwright/test';
import { ADMIN_STATE, chromeArgs } from './support';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const email = process.env.E2E_EMAIL ?? process.env.SEED_ADMIN_EMAIL;
  const password = process.env.E2E_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Faltan E2E_EMAIL/E2E_PASSWORD (o SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD en .env)',
    );
  }
  const { baseURL } = config.projects[0]?.use ?? {};
  const browser = await chromium.launch({ channel: 'chrome', args: chromeArgs() });
  const page = await browser.newPage({ baseURL, locale: 'es-ES' });
  await page.goto('/es/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
  await page.context().storageState({ path: ADMIN_STATE });
  await browser.close();
}
