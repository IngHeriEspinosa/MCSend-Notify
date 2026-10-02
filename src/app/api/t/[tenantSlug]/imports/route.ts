/**
 * Subida de archivos de importación (multipart). Se usa un route handler porque las Server
 * Actions limitan el cuerpo a 1 MB. Controles: sesión + tenant, mismo origen (CSRF), límite de
 * peticiones, tamaño máximo y tipo real del archivo (en el caso de uso).
 */
import type { NextRequest } from 'next/server';
import { errorResponse, isSameOrigin } from '@/app/_server/api-guards';
import { findTenantAccess } from '@/app/_server/session';
import { MAX_IMPORT_FILE_BYTES } from '@/core/contacts/use-cases/imports.use-cases';
import { isDomainError } from '@/core/shared/domain-error';
import { getLogger, getRateLimiter } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function POST(
  request: NextRequest,
  { params }: RouteContext<'/api/t/[tenantSlug]/imports'>,
) {
  if (!isSameOrigin(request)) return errorResponse('FORBIDDEN');
  const { tenantSlug } = await params;
  const access = await findTenantAccess(tenantSlug);
  if (!access) return errorResponse('NOT_FOUND');

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_IMPORT_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return errorResponse('PAYLOAD_TOO_LARGE', { reason: 'FILE_SIZE' });
  }

  try {
    await getRateLimiter('upload').consume(access.user.id);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return errorResponse('BAD_REQUEST');
    if (file.size > MAX_IMPORT_FILE_BYTES)
      return errorResponse('PAYLOAD_TOO_LARGE', { reason: 'FILE_SIZE' });

    const record = await useCases.uploadImport().execute(access.context, {
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ importId: record.id }, { status: 201 });
  } catch (error) {
    if (isDomainError(error)) return errorResponse(error.code, error.details);
    getLogger().error({ err: error, tenantSlug }, 'Error al subir un archivo de importación');
    return Response.json({ error: { code: 'UNEXPECTED' } }, { status: 500 });
  }
}
