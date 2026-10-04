import { describe, expect, it } from 'vitest';
import { HmacPublicAssetLinks } from './signed-asset-links';
import { TrackingHostDirectory } from './tracking-host-directory';
import { HmacTrackingLinks } from './tracking-links';

const SECRET = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const MCSUPPORT = '11111111-1111-7111-8111-111111111111';
const MCLOG = '22222222-2222-7222-8222-222222222222';
const DELIVERY = '0199a8f0-0000-7000-8000-000000000001';

function directoryWith(rows: Array<{ tenantId: string; domain: string }> | Error) {
  const errors: unknown[] = [];
  const directory = new TrackingHostDirectory(
    {
      verifiedDomains: async () => {
        if (rows instanceof Error) throw rows;
        return rows;
      },
    },
    'https://mcsend.example.com/',
    (error) => errors.push(error),
  );
  return { directory, errors };
}

describe('TrackingHostDirectory', () => {
  it('usa el dominio verificado del tenant y el de la plataforma para el resto', async () => {
    const { directory } = directoryWith([{ tenantId: MCSUPPORT, domain: 'clic.mcsupport.com' }]);
    expect(directory.baseUrlFor(MCSUPPORT)).toBe('https://mcsend.example.com');
    await directory.refresh();
    expect(directory.baseUrlFor(MCSUPPORT)).toBe('https://clic.mcsupport.com');
    expect(directory.baseUrlFor(MCLOG)).toBe('https://mcsend.example.com');
    expect(directory.isTrackingHost('CLIC.mcsupport.com')).toBe(true);
    expect(directory.isTrackingHost('mcsend.example.com')).toBe(true);
    expect(directory.isTrackingHost('evil.example.com')).toBe(false);
  });

  it('si el refresco falla conserva la instantánea anterior e informa del error', async () => {
    const source = { rows: [{ tenantId: MCSUPPORT, domain: 'clic.mcsupport.com' }] as const };
    let fail = false;
    const errors: unknown[] = [];
    const directory = new TrackingHostDirectory(
      {
        verifiedDomains: async () => {
          if (fail) throw new Error('BD caída');
          return [...source.rows];
        },
      },
      'https://mcsend.example.com',
      (error) => errors.push(error),
    );
    await directory.refresh();
    fail = true;
    await directory.refresh();
    expect(directory.baseUrlFor(MCSUPPORT)).toBe('https://clic.mcsupport.com');
    expect(errors).toHaveLength(1);
  });
});

describe('firmadores con dominio de seguimiento propio', () => {
  it('los enlaces y recursos del tenant usan su dominio; el token vale en cualquier host', async () => {
    const { directory } = directoryWith([{ tenantId: MCSUPPORT, domain: 'clic.mcsupport.com' }]);
    await directory.refresh();
    const links = new HmacTrackingLinks(SECRET, 'https://mcsend.example.com', directory);
    const assets = new HmacPublicAssetLinks(SECRET, 'https://mcsend.example.com', directory);

    const open = links.openUrl(MCSUPPORT, DELIVERY);
    expect(open.startsWith('https://clic.mcsupport.com/trk/o/')).toBe(true);
    expect(links.verify(open.split('/').pop() ?? '', 'o')).toMatchObject({ t: MCSUPPORT });
    expect(
      links.unsubscribeUrl(MCLOG, DELIVERY).startsWith('https://mcsend.example.com/trk/u/'),
    ).toBe(true);
    expect(
      assets.documentThumbnail(MCSUPPORT, 'doc').startsWith('https://clic.mcsupport.com/trk/i/'),
    ).toBe(true);

    // Las descargas cuentan en el dominio propio y en el de la plataforma (correos anteriores).
    const download = assets.documentDownload(MCSUPPORT, 'doc');
    expect(links.isDocumentDownload(download)).toBe(true);
    expect(links.isDocumentDownload('https://mcsend.example.com/trk/d/abc')).toBe(true);
    expect(links.isDocumentDownload('https://evil.example.com/trk/d/abc')).toBe(false);
    expect(links.isDocumentDownload('http://clic.mcsupport.com/trk/d/abc')).toBe(false);
    expect(links.isDocumentDownload('https://clic.mcsupport.com/otra/ruta')).toBe(false);
  });
});
