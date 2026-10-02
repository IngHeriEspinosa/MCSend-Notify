/**
 * Proxy de Next.js 16 (antes middleware): enrutado por idioma, CSP con nonce y traceId.
 * El nonce y el traceId viajan como cabeceras de la petición hacia los Server Components.
 * La protección de rutas autenticadas se incorpora en la Fase 1.
 */
import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from '@/common/i18n/routing';
import { buildContentSecurityPolicy, generateNonce } from '@/common/utils/content-security-policy';
import { resolveTraceId, TRACE_ID_HEADER } from '@/common/utils/trace-id';

export const NONCE_HEADER = 'x-nonce';

const handleI18nRouting = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const traceId = resolveTraceId(request.headers.get(TRACE_ID_HEADER));
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV !== 'production',
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(TRACE_ID_HEADER, traceId);
  // Next.js lee la CSP de la petición para aplicar el nonce a sus propios scripts.
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const response = handleI18nRouting(new NextRequest(request, { headers: requestHeaders }));
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  response.headers.set(TRACE_ID_HEADER, traceId);
  return response;
}

export const config = {
  // Excluye API, tracking de correos, assets de Next.js y archivos con extensión.
  // El punto va como clase `[.]`: Next.js elimina las barras invertidas al compilar el matcher,
  // y `\.` se convertiría en un comodín que excluye todas las rutas (ver src/proxy.test.ts).
  matcher: ['/((?!api/|trk/|_next/|_vercel|.*[.].*).*)'],
};
