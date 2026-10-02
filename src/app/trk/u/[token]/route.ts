/**
 * Baja de un correo.
 * - POST (cabecera List-Unsubscribe-Post, RFC 8058): baja inmediata con un clic desde el cliente
 *   de correo. Sin cookies ni formulario: el token firmado es la autorización.
 * - GET (enlace del pie): redirige al centro de preferencias, donde la persona confirma. Así los
 *   escáneres de enlaces que siguen el enlace no dan de baja a nadie.
 */
import type { NextRequest } from 'next/server';
import { trackingMeta } from '@/app/_server/tracking-request';
import { getServerEnv } from '@/common/config/env';
import { getLogger, getTrackingLinks } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: RouteContext<'/trk/u/[token]'>) {
  const { token } = await params;
  const payload = getTrackingLinks().verify(token, 'u');
  if (!payload) return new Response('Enlace no válido', { status: 404 });
  const preferences = await useCases.tracking().preferences(payload.t, payload.d);
  const locale = preferences?.locale ?? 'es';
  const intent =
    request.nextUrl.searchParams.get('intent') === 'unsubscribe' ? '?intent=unsubscribe' : '';
  return new Response(null, {
    status: 303,
    headers: {
      // La URL pública (APP_URL): detrás de un proxy, el origen de la petición es el interno.
      Location: new URL(
        `/${locale}/preferences/${token}${intent}`,
        getServerEnv().APP_URL,
      ).toString(),
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request: NextRequest, { params }: RouteContext<'/trk/u/[token]'>) {
  const { token } = await params;
  const payload = getTrackingLinks().verify(token, 'u');
  if (!payload) return new Response('Enlace no válido', { status: 404 });
  try {
    const done = await useCases.tracking().unsubscribe(payload.t, payload.d, trackingMeta(request));
    return new Response(done ? 'OK' : 'Enlace no válido', {
      status: done ? 200 : 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    getLogger().error({ err: error, tenantId: payload.t }, 'Error en la baja con un clic');
    return new Response('Error temporal', { status: 503, headers: { 'Retry-After': '30' } });
  }
}
