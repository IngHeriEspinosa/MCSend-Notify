import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './safe-redirect';

describe('safeRedirectPath', () => {
  it('acepta rutas internas', () => {
    expect(safeRedirectPath('/es/t/mcsupport/contacts?x=1', '/es')).toBe(
      '/es/t/mcsupport/contacts?x=1',
    );
  });

  it.each([
    'https://atacante.example/login',
    '//atacante.example',
    '/\\atacante.example',
    'javascript:alert(1)',
    '/es\r\nSet-Cookie: x=1',
    undefined,
    42,
  ])('rechaza %j y usa la ruta por defecto', (value) => {
    expect(safeRedirectPath(value, '/es/select-tenant')).toBe('/es/select-tenant');
  });
});
