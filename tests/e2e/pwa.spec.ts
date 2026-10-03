/**
 * PWA: manifiesto, service worker (solo en build de producción), instalabilidad según Chrome y
 * página sin conexión en el idioma de la URL. Los datos del tenant nunca se sirven desde caché.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { ADMIN_STATE, TENANT, chromeArgs } from './support';

// Se descarga con el navegador (no con el cliente de Node, que no resuelve `*.localhost` en Windows).
test('el manifiesto describe una app instalable', async ({ page }) => {
  const response = await page.goto('/manifest.webmanifest');
  expect(response?.ok()).toBe(true);
  const manifest = (await response?.json()) as {
    name: string;
    start_url: string;
    display: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  expect(manifest).toMatchObject({ name: 'MC Send Notify', start_url: '/', display: 'standalone' });
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find((item) => item.sizes === size);
    expect(icon, `icono ${size}`).toBeDefined();
    expect((await page.goto(icon?.src ?? ''))?.ok()).toBe(true);
  }
});

test.describe('service worker', () => {
  test.skip(process.env.E2E_DEV === 'true', 'El service worker solo se registra en producción');

  test('se registra, Chrome no ve impedimentos para instalar y sin red muestra la página offline', async ({
    baseURL,
  }) => {
    // Chrome no evalúa la instalación en perfiles de incógnito: perfil persistente temporal
    // (en una ruta ASCII: Chrome en Windows no arranca bien con rutas con tildes).
    const context = await chromium.launchPersistentContext(
      mkdtempSync(join(tmpdir(), 'mcsn-pwa-')),
      {
        channel: 'chrome',
        headless: true,
        ...(baseURL ? { baseURL } : {}),
        args: chromeArgs(),
      },
    );
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('/es/login');
    const scriptUrl = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.active?.scriptURL ?? '';
    });
    expect(scriptUrl).toMatch(/\/sw\.js$/);

    const cdp = await context.newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    expect(installabilityErrors).toEqual([]);

    // La página queda controlada por el service worker tras recargar.
    await page.reload();
    await context.setOffline(true);
    await page.goto('/en/login').catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
    await page.goto('/es/login').catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'Sin conexión' })).toBeVisible();
    await context.setOffline(false);
    await context.close();
  });

  test.describe('con sesión', () => {
    test.use({ storageState: ADMIN_STATE });

    test('las páginas con datos del tenant no se guardan en la caché del dispositivo', async ({
      page,
    }) => {
      await page.goto(`/es/t/${TENANT}/contacts`);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      const cached = await page.evaluate(async () => {
        const urls: string[] = [];
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          urls.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
        }
        return urls;
      });
      expect(cached.filter((path) => path.includes('/t/') || path.startsWith('/api/'))).toEqual([]);
      expect(cached).toContain('/es/offline');
    });

    test('el aviso sin conexión es accesible y desaparece al recuperar la red', async ({
      page,
      context,
    }) => {
      await page.goto(`/es/t/${TENANT}/dashboard`);
      await context.setOffline(true);
      await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toBeVisible();
      await context.setOffline(false);
      await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toHaveCount(0);
    });
  });
});
