import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { TenantContext } from '@/core/shared/tenant-context';
import { BlockImageLoader } from './block-image-loader';

const context: TenantContext = {
  tenantId: '11111111-1111-7111-8111-111111111111',
  tenantSlug: 'mcsupport',
  actor: { type: 'system', reason: 'test' },
};

const READY_ID = '22222222-2222-7222-8222-222222222222';
const SVG_ID = '33333333-3333-7333-8333-333333333333';

async function loaderWith(objects: Record<string, Uint8Array>) {
  return new BlockImageLoader({
    documents: {
      findById: async (_context, id) =>
        id === READY_ID || id === SVG_ID ? { status: 'READY' as const, thumbnailKey: id } : null,
    },
    storage: { getBytes: async (key) => objects[key] ?? new Uint8Array() },
    allowPrivateHosts: false,
  });
}

describe('BlockImageLoader', () => {
  it('reescala y convierte a JPEG la miniatura de un documento listo', async () => {
    const png = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: '#005E7D' },
    })
      .png()
      .toBuffer();
    const image = await (
      await loaderWith({ [READY_ID]: png })
    ).load(context, {
      src: null,
      documentId: READY_ID,
    });
    expect(image.mediaType).toBe('image/jpeg');
    const metadata = await sharp(Buffer.from(image.base64, 'base64')).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 1568 });
  });

  it('rechaza formatos que no son imagen rasterizada aunque se declaren como imagen', async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    await expect(
      (await loaderWith({ [SVG_ID]: svg })).load(context, { src: null, documentId: SVG_ID }),
    ).rejects.toMatchObject({ details: { reason: 'IMAGE_UNAVAILABLE' } });
  });

  it('un documento inexistente o de otro tenant y una URL no https no se cargan', async () => {
    const loader = await loaderWith({});
    await expect(
      loader.load(context, { src: null, documentId: '44444444-4444-7444-8444-444444444444' }),
    ).rejects.toMatchObject({ details: { reason: 'IMAGE_UNAVAILABLE' } });
    await expect(
      loader.load(context, { src: 'http://example.com/a.png', documentId: null }),
    ).rejects.toMatchObject({ details: { reason: 'IMAGE_UNAVAILABLE' } });
  });
});
