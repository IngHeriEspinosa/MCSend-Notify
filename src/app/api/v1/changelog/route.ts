/**
 * Buzón de novedades para las aplicaciones (clave de API con el permiso `changelog:write`).
 *
 *   POST /api/v1/changelog   → publica una novedad; con `externalId` es idempotente (actualiza)
 *   GET  /api/v1/changelog   → últimas novedades (`?limit=50`)
 *
 * Cabecera: `Authorization: Bearer mcsn_...` o `x-api-key: mcsn_...`.
 * Sin cookies: no aplica CSRF. Límite de peticiones por clave.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest, errorResponse } from '@/app/_server/api-guards';
import { changelogEntryInputSchema } from '@/core/changelog/changelog';
import { isDomainError } from '@/core/shared/domain-error';
import { getLogger } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;

function handleError(error: unknown) {
  if (isDomainError(error)) return errorResponse(error.code, error.details);
  if (error instanceof z.ZodError) {
    return errorResponse('VALIDATION', z.flattenError(error).fieldErrors);
  }
  getLogger().error({ err: error }, 'Error inesperado en la API de novedades');
  return Response.json({ error: { code: 'UNEXPECTED' } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const context = await authenticateApiRequest(request);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(200)
      .catch(50)
      .parse(request.nextUrl.searchParams.get('limit') ?? 50);
    const entries = await useCases.changelog().list(context, limit);
    return Response.json({ data: entries });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authenticateApiRequest(request);
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
      return errorResponse('PAYLOAD_TOO_LARGE');
    }
    const input = changelogEntryInputSchema.parse(await request.json());
    const { entry, created } = await useCases.changelog().publish(context, input);
    return Response.json({ data: { id: entry.id, created } }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse('BAD_REQUEST');
    return handleError(error);
  }
}
