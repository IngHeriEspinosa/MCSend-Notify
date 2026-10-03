/**
 * Accesibilidad (axe-core, WCAG 2.2 AA), idioma y ausencia de errores en las páginas principales,
 * en español e inglés y en modo claro y oscuro.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, TENANT, collectPageErrors, expectAccessible } from './support';

const NAMESPACES = Object.keys(
  JSON.parse(readFileSync('src/common/i18n/messages/es.json', 'utf8')) as Record<string, unknown>,
);
/** Una clave sin traducir se muestra como `Namespace.clave` (fallback de next-intl). */
const RAW_KEY = new RegExp(`\\b(${NAMESPACES.join('|')})\\.[a-z][A-Za-z_]*\\b`);

const PUBLIC_PAGES = ['/es/login', '/en/login', '/es/offline', '/en/offline'];

const TENANT_PAGES = [
  'dashboard',
  'contacts',
  'contacts/new',
  'lists',
  'segments',
  'campaigns',
  'templates',
  'documents',
  'automations',
  'approvals',
  'changelog',
  'activity',
  'settings/general',
  'settings/branding',
  'settings/providers',
  'settings/senders',
  'settings/ai',
  'settings/members',
  'settings/fields',
  'settings/tags',
  'settings/topics',
  'settings/api-keys',
  'settings/webhooks',
];

const APP_PAGES = [
  ...TENANT_PAGES.map((path) => `/es/t/${TENANT}/${path}`),
  `/en/t/${TENANT}/dashboard`,
  `/en/t/${TENANT}/campaigns`,
  `/en/t/${TENANT}/settings/webhooks`,
  '/es/select-tenant',
  '/es/admin/tenants',
  '/es/admin/queues',
  '/es/admin/ai-usage',
  '/en/admin/queues',
];

async function checkPage(page: Page, path: string) {
  const errors = collectPageErrors(page);
  const response = await page.goto(path);
  expect(response?.status(), `HTTP de ${path}`).toBeLessThan(400);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('lang', path.slice(1, 3));
  await expect(page.locator('main, [role="main"]').first()).toBeVisible();
  expect(await page.title()).not.toBe('');
  const text = await page.locator('body').innerText();
  expect(text.match(RAW_KEY)?.[0] ?? null, `Clave sin traducir en ${path}`).toBeNull();
  await expectAccessible(page, path);
  expect(errors, `Errores en ${path}`).toEqual([]);
}

test.describe('páginas públicas', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path}`, async ({ page }) => checkPage(page, path));
  }
});

test.describe('aplicación (modo claro)', () => {
  test.use({ storageState: ADMIN_STATE });
  for (const path of APP_PAGES) {
    test(`${path}`, async ({ page }) => checkPage(page, path));
  }
});

test.describe('aplicación (modo oscuro)', () => {
  test.use({ storageState: ADMIN_STATE, colorScheme: 'dark' });
  for (const path of [
    `/es/t/${TENANT}/dashboard`,
    `/es/t/${TENANT}/settings/webhooks`,
    '/es/login',
  ]) {
    test(`${path}`, async ({ page }) => checkPage(page, path));
  }
});

test.describe('teclado', () => {
  test('el primer tabulador lleva al enlace para saltar al contenido', async ({ page }) => {
    await page.goto('/es/login');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
  });

  test('el inicio de sesión se completa solo con teclado (error accesible)', async ({ page }) => {
    await page.goto('/es/login');
    await page.getByLabel('Correo electrónico').focus();
    await page.keyboard.type('nadie@example.com');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Contraseña')).toBeFocused();
    await page.keyboard.type('contraseña-incorrecta');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'incorrectos' })).toBeVisible();
  });

  test.describe('con sesión', () => {
    test.use({ storageState: ADMIN_STATE });

    test('el menú lateral se recorre con el teclado y marca la página actual', async ({ page }) => {
      await page.goto(`/es/t/${TENANT}/settings/webhooks`);
      // El menú móvil también está en el DOM (oculto): solo cuenta el visible.
      const current = page.locator('nav a[aria-current="page"]').filter({ visible: true });
      await expect(current).toContainText('Webhooks');
      await current.focus();
      await expect(current).toBeFocused();
    });
  });
});
