/**
 * Archivos de un documento para la interfaz (miniatura, PDF o descarga del original).
 * Requiere sesión y membresía; el original siempre se descarga como adjunto.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/app/_server/api-guards';
import { fileResponse } from '@/app/_server/file-response';
import { findTenantAccess } from '@/app/_server/session';
import { safeDownloadName } from '@/core/documents/document';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

const variantSchema = z.enum(['original', 'pdf', 'thumbnail']).catch('thumbnail');

export async function GET(
  request: NextRequest,
  { params }: RouteContext<'/api/t/[tenantSlug]/documents/[documentId]/file'>,
) {
  const { tenantSlug, documentId } = await params;
  if (!z.uuid().safeParse(documentId).success) return errorResponse('NOT_FOUND');
  const access = await findTenantAccess(tenantSlug);
  if (!access) return errorResponse('NOT_FOUND');
  const variant = variantSchema.parse(request.nextUrl.searchParams.get('variant'));

  try {
    const file = await useCases.documents().file(access.context, documentId, variant);
    const extension =
      variant === 'original' ? file.record.extension : variant === 'pdf' ? 'pdf' : 'jpg';
    return fileResponse(file.stream, {
      contentType: file.contentType,
      disposition: variant === 'original' ? 'attachment' : 'inline',
      fileName: safeDownloadName(file.record.title, extension),
      utf8FileName: `${file.record.title}.${extension}`,
      cacheControl: 'private, max-age=300',
    });
  } catch (error) {
    if (isDomainError(error)) return errorResponse(error.code);
    throw error;
  }
}
