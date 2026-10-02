/**
 * Acceso a la sesión y al tenant desde Server Components, Server Actions y route handlers.
 * `requireTenant` es la única vía para obtener un TenantContext en la presentación: el tenant
 * se resuelve a partir del slug de la URL y de la membresía, nunca de datos del cliente.
 */
import 'server-only';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { isDomainError } from '@/core/shared/domain-error';
import type { RequestMeta } from '@/core/shared/tenant-context';
import { useCases } from '@/infrastructure/use-case-factory';
import { auth } from './auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  platformRole: 'SUPER_ADMIN' | 'USER';
}

export const getOptionalUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    platformRole: session.user.platformRole,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getOptionalUser();
  if (!user) {
    const locale = await getLocale();
    redirect(`/${locale}/login`);
  }
  return user;
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.platformRole !== 'SUPER_ADMIN') notFound();
  return user;
}

export const getRequestMeta = cache(async (): Promise<RequestMeta> => {
  const list = await headers();
  return {
    ip: list.get('x-forwarded-for')?.split(',')[0]?.trim() || list.get('x-real-ip') || undefined,
    userAgent: list.get('user-agent') ?? undefined,
  };
});

/** Resuelve el tenant de la URL para el usuario de la sesión (404 si no tiene acceso). */
export const requireTenant = cache(async (tenantSlug: string) => {
  const user = await requireUser();
  try {
    const { tenant, context } = await useCases
      .resolveTenantAccess()
      .execute(user, tenantSlug, await getRequestMeta());
    return { user, tenant, context };
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  }
});

/** Variante para route handlers: devuelve null en lugar de redirigir o lanzar 404. */
export async function findTenantAccess(tenantSlug: string) {
  const user = await getOptionalUser();
  if (!user) return null;
  try {
    const { tenant, context } = await useCases
      .resolveTenantAccess()
      .execute(user, tenantSlug, await getRequestMeta());
    return { user, tenant, context };
  } catch (error) {
    if (isDomainError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}
