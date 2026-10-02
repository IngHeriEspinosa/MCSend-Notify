import { describe, expect, it } from 'vitest';
import { HmacPublicAssetLinks } from './signed-asset-links';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const TENANT = '11111111-1111-7111-8111-111111111111';
const DOCUMENT = '0199a8f0-0000-7000-8000-000000000001';
const links = new HmacPublicAssetLinks(SECRET, 'https://app.test/');

const tokenOf = (url: string) => url.split('/').pop() ?? '';

describe('HmacPublicAssetLinks', () => {
  it('genera URL por propósito y las verifica', () => {
    const thumbnail = links.documentThumbnail(TENANT, DOCUMENT);
    const download = links.documentDownload(TENANT, DOCUMENT);
    expect(thumbnail.startsWith('https://app.test/trk/i/')).toBe(true);
    expect(download.startsWith('https://app.test/trk/d/')).toBe(true);
    expect(links.verify(tokenOf(thumbnail))).toEqual({ v: 1, p: 'thumb', t: TENANT, r: DOCUMENT });
    expect(links.verify(tokenOf(download))?.p).toBe('file');
  });

  it('rechaza tokens manipulados (otro recurso con la firma original)', () => {
    const [, signature] = tokenOf(links.documentThumbnail(TENANT, DOCUMENT)).split('.');
    const forged = Buffer.from(
      JSON.stringify({ v: 1, p: 'file', t: TENANT, r: '0199a8f0-0000-7000-8000-000000000999' }),
    ).toString('base64url');
    expect(links.verify(`${forged}.${signature}`)).toBeNull();
  });

  it('rechaza tokens firmados con otro secreto', () => {
    const other = new HmacPublicAssetLinks(
      'otro-secreto-de-pruebas-de-32-caracteres!!',
      'https://app.test',
    );
    expect(links.verify(tokenOf(other.documentThumbnail(TENANT, DOCUMENT)))).toBeNull();
  });

  it('rechaza formatos inválidos sin lanzar', () => {
    for (const token of ['', 'abc', 'a.b.c', 'x'.repeat(2000), '%%%.%%%']) {
      expect(links.verify(token)).toBeNull();
    }
  });
});
