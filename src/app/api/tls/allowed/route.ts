/**
 * Consulta de Caddy para el TLS bajo demanda (`on_demand_tls { ask ... }`):
 *
 *   GET /api/tls/allowed?domain=clic.mcsupport.com  → 200 si es un dominio de seguimiento
 *                                                     verificado de un tenant activo; 404 si no.
 *
 * Caddy la llama por la red interna de Docker (app:3000). Desde fuera, Caddy responde 404 a
 * `/api/tls/*` en el dominio de la plataforma (Caddyfile), para no revelar qué dominios existen.
 */
import type { NextRequest } from 'next/server';
import { getLogger } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const domain = request.nextUrl.searchParams.get('domain') ?? '';
  try {
    const allowed = await useCases.trackingDomainTls().isAllowed(domain);
    return new Response(null, { status: allowed ? 200 : 404 });
  } catch (error) {
    getLogger().error({ err: error }, 'Error al autorizar un certificado bajo demanda');
    return new Response(null, { status: 503 });
  }
}
