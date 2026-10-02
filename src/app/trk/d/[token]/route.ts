/**
 * Descarga pública del documento original enlazado en un correo (URL firmada, sin sesión).
 * Siempre como adjunto. En la Fase 3 registrará el evento de descarga del destinatario.
 */
import type { NextRequest } from 'next/server';
import { fileResponse } from '@/app/_server/file-response';
import { safeDownloadName } from '@/core/documents/document';
import { isDomainError } from '@/core/shared/domain-error';
import { getLogger, getPublicAssetLinks } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(_request: NextRequest, { params }: RouteContext<'/trk/d/[token]'>) {
  const { token } = await params;
  const payload = getPublicAssetLinks().verify(token);
  if (payload?.p !== 'file') return notFound();

  try {
    const file = await useCases.publicAssets().document(payload.t, payload.r, 'original');
    return fileResponse(file.stream, {
      contentType: file.contentType,
      disposition: 'attachment',
      fileName: safeDownloadName(file.record.title, file.record.extension),
      utf8FileName: `${file.record.title}.${file.record.extension}`,
      cacheControl: 'private, no-store',
      crossOrigin: true,
    });
  } catch (error) {
    if (!isDomainError(error)) {
      getLogger().warn({ err: error, tenantId: payload.t }, 'Descarga pública no disponible');
    }
    return notFound();
  }
}
