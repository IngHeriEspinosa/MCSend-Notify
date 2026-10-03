/**
 * Flujos de la Fase 5: webhooks salientes (secreto mostrado una vez, prueba firmada, registro de
 * entregas, rotación y borrado), API de eventos con su permiso, supresión RGPD de un contacto y
 * panel de colas.
 *
 * La entrega real del webhook necesita que el worker alcance el receptor de la prueba:
 * E2E_WEBHOOK_DELIVERY=true y E2E_WEBHOOK_HOST (por defecto `host.docker.internal`, el worker en
 * Docker) con SSRF_ALLOW_PRIVATE=true. Sin ellas se comprueba que el destino privado se bloquea.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE, TENANT } from './support';

test.use({ storageState: ADMIN_STATE });

const DELIVERY = process.env.E2E_WEBHOOK_DELIVERY === 'true';
const WEBHOOK_HOST = process.env.E2E_WEBHOOK_HOST ?? 'host.docker.internal';

let receiver: Server;
let receiverUrl: string;
const received: Array<{ headers: IncomingHttpHeaders; body: string }> = [];

test.beforeAll(async () => {
  receiver = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => {
      received.push({ headers: request.headers, body });
      response.statusCode = 204;
      response.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '0.0.0.0', resolve));
  receiverUrl = `http://${WEBHOOK_HOST}:${(receiver.address() as AddressInfo).port}/hooks`;
});

test.afterAll(() => new Promise<void>((resolve) => receiver.close(() => resolve())));

function validSignature(secret: string, headers: IncomingHttpHeaders, body: string): boolean {
  const expected = Buffer.from(
    'v1=' +
      createHmac('sha256', secret)
        .update(`${String(headers['x-mcsn-timestamp'])}.${body}`)
        .digest('hex'),
  );
  const actual = Buffer.from(String(headers['x-mcsn-signature'] ?? ''));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readSecret(page: Page): Promise<string> {
  const field = page.getByRole('textbox', { name: 'Secreto de firma' });
  await expect(field).toHaveValue(/^whsec_/);
  return field.inputValue();
}

test('webhooks: alta con secreto único, prueba firmada, registro, rotación y borrado', async ({
  page,
}) => {
  const description = `E2E ${randomUUID().slice(0, 8)}`;
  await page.goto(`/es/t/${TENANT}/settings/webhooks`);
  await page.getByRole('button', { name: 'Nuevo destino' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('URL del destino').fill(receiverUrl);
  await dialog.getByLabel('Descripción').fill(description);
  await dialog.getByRole('checkbox', { name: /Rebote permanente/ }).check();
  await dialog.getByRole('button', { name: 'Crear' }).click();
  const secret = await readSecret(page);
  await page.getByRole('button', { name: 'Cerrar' }).click();

  const row = page.getByRole('row').filter({ hasText: description });
  await expect(row).toContainText('Campaña enviada');
  await expect(row).toContainText('Rebote permanente');
  await expect(row).toContainText('Activo');

  await row.getByRole('button', { name: 'Probar' }).click();
  await expect(page.getByText('Evento de prueba en cola.')).toBeVisible();

  if (DELIVERY) {
    await expect.poll(() => received.length, { timeout: 30_000 }).toBeGreaterThan(0);
    const delivery = received.at(-1);
    expect(delivery?.headers['x-mcsn-event']).toBe('webhook.test');
    expect(validSignature(secret, delivery?.headers ?? {}, delivery?.body ?? '')).toBe(true);
    expect(JSON.parse(delivery?.body ?? '{}')).toMatchObject({
      type: 'webhook.test',
      tenant: TENANT,
    });
  }

  // Registro de entregas: entregada o, sin receptor alcanzable, reintentando/bloqueada.
  await expect
    .poll(
      async () => {
        await row.getByRole('button', { name: 'Entregas' }).click();
        const log = page.getByRole('dialog');
        const text = await log.innerText();
        await log.getByRole('button', { name: 'Cerrar' }).click();
        return text;
      },
      { timeout: 30_000 },
    )
    .toMatch(DELIVERY ? /Entregado/ : /Reintentando|Fallido/);

  await row.getByRole('button', { name: 'Rotar secreto' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Rotar secreto' }).click();
  const rotated = await readSecret(page);
  expect(rotated).not.toBe(secret);
  await page.getByRole('button', { name: 'Cerrar' }).click();

  await row.getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByRole('row').filter({ hasText: description })).toHaveCount(0);
});

/**
 * Llamada a la API desde el navegador (mismo origen). El cliente HTTP de Node no resuelve
 * `*.localhost` en Windows y el despliegue con TLS interno se prueba con ese nombre.
 */
async function api(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  key: string | null,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ method, path, key, body }) => {
      const response = await fetch(path, {
        method,
        credentials: 'omit',
        headers: {
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
    },
    { method, path, key, body },
  );
}

test('API de eventos: exige clave con permiso y valida el cuerpo', async ({ page }) => {
  const name = `Eventos E2E ${randomUUID().slice(0, 8)}`;
  await page.goto(`/es/t/${TENANT}/settings/api-keys`);
  await page.getByRole('button', { name: 'Nueva clave' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill(name);
  await dialog.getByRole('checkbox', { name: 'Crear y actualizar contactos' }).uncheck();
  await dialog
    .getByRole('checkbox', { name: 'Enviar eventos que disparan automatizaciones' })
    .check();
  await dialog.getByRole('button', { name: 'Crear' }).click();
  const key = await dialog.getByRole('textbox', { name: 'Claves de API' }).inputValue();
  expect(key).toMatch(/^mcsn_/);
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  const accepted = await api(page, 'POST', '/api/v1/events', key, {
    event: 'e2e.no-listeners',
    id: randomUUID().slice(0, 12),
    data: { version: '1.0' },
  });
  expect(accepted).toEqual({
    status: 202,
    body: { data: { event: 'e2e.no-listeners', triggered: [] } },
  });

  expect((await api(page, 'POST', '/api/v1/events', key, { event: 'Con Espacios' })).status).toBe(
    422,
  );
  expect((await api(page, 'POST', '/api/v1/events', null, { event: 'x.y' })).status).toBe(401);

  // La clave de eventos no sirve para leer contactos (ámbito distinto).
  const contacts = await api(page, 'GET', '/api/v1/contacts?email=nadie%40example.com', key);
  expect(contacts.status).toBe(403);

  const row = page.getByRole('row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Revocar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Revocar' }).click();
  await expect(row).toContainText('Revocada');
  expect((await api(page, 'POST', '/api/v1/events', key, { event: 'x.y' })).status).toBe(401);
});

test('RGPD: eliminar un contacto lo suprime y explica el alcance', async ({ page }) => {
  const email = `rgpd-${randomUUID().slice(0, 8)}@example.com`;
  await page.goto(`/es/t/${TENANT}/contacts/new`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Nombre', { exact: true }).fill('Prueba RGPD');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Contacto creado')).toBeVisible();
  await page.waitForURL(/\/contacts\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: 'Eliminar' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('historial de envíos');
  await dialog.getByRole('button', { name: 'Eliminar' }).click();
  await page.waitForURL(/\/contacts$/);
  await page.getByPlaceholder('Buscar por email, nombre o empresa').fill(email);
  await expect(page.getByText(email)).toHaveCount(0);
});

test('panel de colas: muestra todas las colas del worker', async ({ page }) => {
  await page.goto('/es/admin/queues');
  for (const queue of ['email-send', 'outbound-webhook', 'automation-run', 'maintenance']) {
    await expect(page.getByRole('cell', { name: queue })).toBeVisible();
  }
  await page.getByRole('link', { name: 'Uso de IA' }).click();
  await expect(page.getByRole('heading', { name: 'Uso de IA por aplicación' })).toBeVisible();
});

test.describe('antivirus', () => {
  test.skip(process.env.E2E_CLAMAV !== 'true', 'Requiere ClamAV (perfil security y CLAMAV_HOST)');

  test('un archivo con la firma de prueba EICAR se pone en cuarentena', async ({ page }) => {
    const title = `antivirus-${randomUUID().slice(0, 8)}`;
    // Archivo de prueba estándar EICAR (inofensivo), en base64 para no escribirlo literal.
    const eicar = Buffer.from(
      'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
      'base64',
    );
    await page.goto(`/es/t/${TENANT}/documents`);
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: `${title}.txt`, mimeType: 'text/plain', buffer: eicar });
    const card = page.getByRole('link', { name: new RegExp(title) });
    await expect(card).toBeVisible();
    await card.click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}$/);
    await expect
      .poll(
        async () => {
          await page.reload();
          return page.locator('main').innerText();
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toContain('El antivirus detectó contenido malicioso');
  });
});
