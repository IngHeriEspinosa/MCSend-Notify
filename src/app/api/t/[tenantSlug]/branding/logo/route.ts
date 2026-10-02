/** Subida del logotipo de los correos (multipart, máx. 2 MB, PNG/JPEG/WebP). */
import type { NextRequest } from 'next/server';
import { errorResponse, isSameOrigin } from '@/app/_server/api-guards';
import { findTenantAccess } from '@/app/_server/session';
import { isDomainError } from '@/core/shared/domain-error';
import { MAX_LOGO_BYTES } from '@/core/tenants/branding.use-cases';
import { getLogger, getRateLimiter } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: RouteContext<'/api/t/[tenantSlug]/branding/logo'>,
) {
  if (!isSameOrigin(request)) return errorResponse('FORBIDDEN');
  const { tenantSlug } = await params;
  const access = await findTenantAccess(tenantSlug);
  if (!access) return errorResponse('NOT_FOUND');
  if (Number(request.headers.get('content-length') ?? '0') > MAX_LOGO_BYTES + 64 * 1024) {
    return errorResponse('PAYLOAD_TOO_LARGE', { reason: 'FILE_SIZE' });
  }

  try {
    await getRateLimiter('upload').consume(access.user.id);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return errorResponse('BAD_REQUEST');
    const result = await useCases.branding().uploadLogo(access.context, {
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (isDomainError(error)) return errorResponse(error.code, error.details);
    getLogger().error({ err: error, tenantSlug }, 'Error al subir el logotipo');
    return Response.json({ error: { code: 'UNEXPECTED' } }, { status: 500 });
  }
}
