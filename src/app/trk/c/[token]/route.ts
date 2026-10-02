/**
 * Clic rastreado: registra el evento y redirige al destino guardado en la base de datos para ese
 * enlace (el token solo lleva ids, así que no hay redirección abierta). Las peticiones HEAD y los
 * escáneres de enlaces se registran marcados como bot.
 */
import type { NextRequest } from 'next/server';
import { trackingMeta } from '@/app/_server/tracking-request';
import { getLogger, getTrackingLinks } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

async function handle(request: NextRequest, token: string): Promise<Response> {
  const payload = getTrackingLinks().verify(token, 'c');
  if (!payload?.l) return new Response('Enlace no válido', { status: 404 });
  try {
    const url = await useCases
      .tracking()
      .click(payload.t, payload.d, payload.l, trackingMeta(request));
    if (!url) return new Response('Enlace no válido', { status: 404 });
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (error) {
    getLogger().error({ err: error, tenantId: payload.t }, 'Error al registrar un clic');
    return new Response('Error temporal', { status: 503, headers: { 'Retry-After': '30' } });
  }
}

export async function GET(request: NextRequest, { params }: RouteContext<'/trk/c/[token]'>) {
  return handle(request, (await params).token);
}

export async function HEAD(request: NextRequest, { params }: RouteContext<'/trk/c/[token]'>) {
  return handle(request, (await params).token);
}
