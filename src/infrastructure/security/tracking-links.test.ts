import { describe, expect, it } from 'vitest';
import { hashIp, HmacTrackingLinks } from './tracking-links';

const TENANT = '11111111-1111-7111-8111-111111111111';
const DELIVERY = '0199a8f0-0000-7000-8000-000000000001';
const LINK = '0199a8f0-0000-7000-8000-000000000002';
const links = new HmacTrackingLinks(
  'secreto-de-pruebas-con-mas-de-32-caracteres',
  'https://app.test',
);
const token = (url: string) => url.split('/').pop()?.split('?')[0] ?? '';

describe('HmacTrackingLinks', () => {
  it('firma y verifica cada propósito', () => {
    expect(links.verify(token(links.openUrl(TENANT, DELIVERY)), 'o')).toEqual({
      p: 'o',
      t: TENANT,
      d: DELIVERY,
    });
    expect(links.verify(token(links.clickUrl(TENANT, DELIVERY, LINK)), 'c')).toMatchObject({
      l: LINK,
    });
    expect(links.verify(token(links.unsubscribeUrl(TENANT, DELIVERY)), 'u')?.d).toBe(DELIVERY);
  });

  it('un token de un propósito no sirve para otro', () => {
    expect(links.verify(token(links.openUrl(TENANT, DELIVERY)), 'u')).toBeNull();
  });

  it('rechaza tokens manipulados o de otro secreto', () => {
    const valid = token(links.unsubscribeUrl(TENANT, DELIVERY));
    const [, signature] = valid.split('.');
    const forged = Buffer.from(JSON.stringify({ p: 'u', t: TENANT, d: LINK })).toString(
      'base64url',
    );
    expect(links.verify(`${forged}.${signature}`, 'u')).toBeNull();
    const other = new HmacTrackingLinks(
      'otro-secreto-de-pruebas-con-32-caracteres!',
      'https://app.test',
    );
    expect(links.verify(token(other.unsubscribeUrl(TENANT, DELIVERY)), 'u')).toBeNull();
  });

  it('reconoce las descargas de documentos de la propia app', () => {
    expect(links.isDocumentDownload('https://app.test/trk/d/abc.def')).toBe(true);
    expect(links.isDocumentDownload('https://evil.test/trk/d/abc')).toBe(false);
  });

  it('anonimiza la IP con sal diaria', () => {
    const today = hashIp('s', '203.0.113.5', '2026-10-02');
    expect(today).toBe(hashIp('s', '203.0.113.5', '2026-10-02'));
    expect(today).not.toBe(hashIp('s', '203.0.113.5', '2026-10-03'));
    expect(today).not.toContain('203');
    expect(hashIp('s', undefined, '2026-10-02')).toBeUndefined();
  });
});
