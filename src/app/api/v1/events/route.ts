/**
 * Eventos de las aplicaciones (clave de API con el permiso `events:write`).
 *
 *   POST /api/v1/events  { "event": "release.published", "id": "rel-2.4.0", "data": { ... } }
 *
 * Ejecuta cada automatización activa que escucha ese evento; `data` se añade como fuente para la
 * IA. Con `id` el disparo es idempotente: si el emisor reintenta, no se generan campañas
 * duplicadas. Responde 202 con las automatizaciones disparadas.
 *
 * Cabecera: `Authorization: Bearer mcsn_...` o `x-api-key: mcsn_...`.
 * Sin cookies: no aplica CSRF. Límite de peticiones por clave.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateApiRequest, errorResponse } from '@/app/_server/api-guards';
import { automationEventSchema } from '@/core/automations/automation';
import { isDomainError } from '@/core/shared/domain-error';
import { getLogger } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: NextRequest) {
  try {
    const context = await authenticateApiRequest(request);
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
      return errorResponse('PAYLOAD_TOO_LARGE');
    }
    const body = await request.text();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return errorResponse('PAYLOAD_TOO_LARGE');
    const input = automationEventSchema.parse(JSON.parse(body));
    const { triggered } = await useCases.automations().triggerEvent(context, input);
    return Response.json({ data: { event: input.event, triggered } }, { status: 202 });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse('BAD_REQUEST');
    if (isDomainError(error)) return errorResponse(error.code, error.details);
    if (error instanceof z.ZodError) {
      return errorResponse('VALIDATION', z.flattenError(error).fieldErrors);
    }
    getLogger().error({ err: error }, 'Error inesperado en la API de eventos');
    return Response.json({ error: { code: 'UNEXPECTED' } }, { status: 500 });
  }
}
