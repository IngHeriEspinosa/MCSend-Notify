/**
 * API pública de contactos para integraciones (autenticación con clave de API).
 *
 *   GET  /api/v1/contacts?email=ana@cliente.com   → busca un contacto (scope contacts:read)
 *   POST /api/v1/contacts                          → alta o actualización por email (contacts:write)
 *
 * Cabecera: `Authorization: Bearer mcsn_...` o `x-api-key: mcsn_...`.
 * Sin cookies: no aplica CSRF. Límite de peticiones por clave.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/app/_server/api-guards';
import { contactInputSchema, contactQuerySchema } from '@/core/contacts/contact';
import { normalizeEmail } from '@/core/identity/email';
import { isDomainError } from '@/core/shared/domain-error';
import type { TenantContext } from '@/core/shared/tenant-context';
import { getLogger, getRateLimiter } from '@/infrastructure/container';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

function readApiKey(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return request.headers.get('x-api-key');
}

async function authenticate(request: NextRequest): Promise<TenantContext> {
  const key = readApiKey(request);
  const context = await useCases.authenticateApiKey().execute(key ?? '');
  if (context.actor.type === 'apiKey')
    await getRateLimiter('publicApi').consume(context.actor.apiKeyId);
  return context;
}

function handleError(error: unknown) {
  if (isDomainError(error)) return errorResponse(error.code, error.details);
  if (error instanceof z.ZodError)
    return errorResponse('VALIDATION', z.flattenError(error).fieldErrors);
  getLogger().error({ err: error }, 'Error inesperado en la API pública de contactos');
  return Response.json({ error: { code: 'UNEXPECTED' } }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const context = await authenticate(request);
    const email = z.email().parse(request.nextUrl.searchParams.get('email'));
    const page = await useCases
      .listContacts()
      .execute(context, contactQuerySchema.parse({ search: normalizeEmail(email), pageSize: 5 }));
    const match = page.items.find((item) => normalizeEmail(item.email) === normalizeEmail(email));
    if (!match) return errorResponse('NOT_FOUND');
    const contact = await useCases.getContact().execute(context, match.id);
    return Response.json({ data: contact });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await authenticate(request);
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
      return errorResponse('PAYLOAD_TOO_LARGE');
    }
    const input = contactInputSchema.parse(await request.json());
    const { contact, created } = await useCases.upsertContact().execute(context, input);
    return Response.json({ data: { id: contact.id, created } }, { status: created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse('BAD_REQUEST');
    return handleError(error);
  }
}
