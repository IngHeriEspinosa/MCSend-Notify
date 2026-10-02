/**
 * Webhooks entrantes de los proveedores (Resend con firma Svix, Amazon SES vía SNS).
 * El token de la URL identifica la configuración; la firma del cuerpo la autentica. Se responde en
 * cuanto el evento queda guardado y encolado: el worker aplica los cambios.
 */
import type { NextRequest } from 'next/server';
import { isDomainError } from '@/core/shared/domain-error';
import { getLogger } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(
  request: NextRequest,
  { params }: RouteContext<'/api/webhooks/email/[endpointToken]'>,
) {
  const { endpointToken } = await params;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(endpointToken)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    return Response.json({ error: 'too_large' }, { status: 413 });
  }
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return Response.json({ error: 'too_large' }, { status: 413 });
  const headers = Object.fromEntries(
    [...request.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
  );

  try {
    const result = await useCases.ingestWebhook().execute(endpointToken, { headers, body });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (isDomainError(error)) {
      if (error.code === 'NOT_FOUND') return Response.json({ error: 'not_found' }, { status: 404 });
      if (error.code === 'FORBIDDEN')
        return Response.json({ error: 'invalid_signature' }, { status: 401 });
    }
    if (error instanceof SyntaxError)
      return Response.json({ error: 'bad_request' }, { status: 400 });
    getLogger().error({ err: error }, 'Error al procesar un webhook de proveedor');
    return Response.json({ error: 'unexpected' }, { status: 500 });
  }
}
