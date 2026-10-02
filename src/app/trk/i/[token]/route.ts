/**
 * Imágenes públicas de los correos (miniaturas de documentos y logotipo) con URL firmada.
 * Sin sesión: la firma HMAC identifica el tenant y el recurso. Los clientes de correo y sus
 * proxies (Gmail, Outlook) pueden cachearlas.
 */
import type { NextRequest } from 'next/server';
import { fileResponse } from '@/app/_server/file-response';
import { isDomainError } from '@/core/shared/domain-error';
import { getLogger, getPublicAssetLinks } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(_request: NextRequest, { params }: RouteContext<'/trk/i/[token]'>) {
  const { token } = await params;
  const payload = getPublicAssetLinks().verify(token);
  if (!payload || payload.p === 'file') return notFound();

  try {
    if (payload.p === 'logo') {
      const stream = await useCases.publicAssets().logo(payload.t, payload.r);
      return fileResponse(stream, {
        contentType: 'image/png',
        disposition: 'inline',
        cacheControl: 'public, max-age=604800',
        crossOrigin: true,
      });
    }
    const file = await useCases.publicAssets().document(payload.t, payload.r, 'thumbnail');
    return fileResponse(file.stream, {
      contentType: 'image/jpeg',
      disposition: 'inline',
      cacheControl: 'public, max-age=86400',
      crossOrigin: true,
    });
  } catch (error) {
    if (!isDomainError(error)) {
      getLogger().warn({ err: error, tenantId: payload.t }, 'Recurso público no disponible');
    }
    return notFound();
  }
}
