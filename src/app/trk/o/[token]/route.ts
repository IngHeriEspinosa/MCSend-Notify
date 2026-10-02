/**
 * Píxel de apertura (GIF transparente de 1×1). Responde siempre la imagen, también con un token
 * inválido, para no revelar nada; el registro nunca bloquea la respuesta con un error.
 */
import type { NextRequest } from 'next/server';
import { trackingMeta } from '@/app/_server/tracking-request';
import { getLogger, getTrackingLinks } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function GET(request: NextRequest, { params }: RouteContext<'/trk/o/[token]'>) {
  const { token } = await params;
  const payload = getTrackingLinks().verify(token, 'o');
  if (payload) {
    try {
      await useCases.tracking().open(payload.t, payload.d, trackingMeta(request));
    } catch (error) {
      getLogger().warn({ err: error, tenantId: payload.t }, 'No se pudo registrar la apertura');
    }
  }
  return new Response(new Uint8Array(PIXEL), {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}
