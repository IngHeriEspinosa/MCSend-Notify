/**
 * Dominio de seguimiento propio en Configuración › General: alta con verificación inmediata (sin
 * CNAME queda «Sin verificar» con las instrucciones), validación y baja. La verificación real
 * necesita un CNAME público hacia APP_DOMAIN y se cubre en los tests unitarios y de integración.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { ADMIN_STATE, TENANT, expectAccessible } from './support';

test.use({ storageState: ADMIN_STATE });

test('alta sin CNAME, instrucciones accesibles y baja', async ({ page }) => {
  // Los subdominios de example.com (RFC 2606) no tienen CNAME.
  const domain = `clic-${randomUUID().slice(0, 8)}.example.com`;
  await page.goto(`/es/t/${TENANT}/settings/general`);
  const section = page.getByRole('region', { name: 'Dominio de seguimiento' });
  await expect(section).toBeVisible();

  await section.getByLabel('Dominio').fill('https://no-es-un-dominio');
  await section.getByRole('button', { name: 'Guardar y verificar' }).click();
  await expect(page.getByText('Escribe un subdominio público válido')).toBeVisible();

  await section.getByLabel('Dominio').fill(`  ${domain.toUpperCase()}. `);
  await section.getByRole('button', { name: 'Guardar y verificar' }).click();
  await expect(section.getByText(domain, { exact: true }).first()).toBeVisible();
  await expect(section.getByText('Sin verificar')).toBeVisible();
  await expect(section.getByText('No se encontró el registro CNAME')).toBeVisible();
  await expect(section.getByRole('table')).toContainText('CNAME');
  await expectAccessible(page, 'dominio de seguimiento');

  // Persistido: tras recargar sigue configurado.
  await page.reload();
  await expect(section.getByText('Sin verificar')).toBeVisible();

  await section.getByRole('button', { name: 'Quitar dominio' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Quitar dominio' }).click();
  await expect(section.getByLabel('Dominio')).toBeVisible();
});
