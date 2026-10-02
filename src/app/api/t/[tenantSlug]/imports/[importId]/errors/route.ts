/** Descarga del informe CSV de errores de una importación (solo para el propio tenant). */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/app/_server/api-guards';
import { findTenantAccess } from '@/app/_server/session';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: RouteContext<'/api/t/[tenantSlug]/imports/[importId]/errors'>,
) {
  const { tenantSlug, importId } = await params;
  if (!z.uuid().safeParse(importId).success) return errorResponse('NOT_FOUND');
  const access = await findTenantAccess(tenantSlug);
  if (!access) return errorResponse('NOT_FOUND');

  try {
    const bytes = await useCases.getImport().errorReport(access.context, importId);
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="import-${importId}-errors.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (isDomainError(error)) return errorResponse(error.code);
    throw error;
  }
}
