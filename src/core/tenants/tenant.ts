/** Entidad Tenant (aplicación o producto de Multicómputos) y su puerto de persistencia. */
import { z } from 'zod';
import type { MembershipRole } from '@/core/identity/roles';
import type { TenantContext } from '@/core/shared/tenant-context';

export const SUPPORTED_LOCALES = ['es', 'en'] as const;

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  defaultLocale: string;
  timezone: string;
  postalAddress: string | null;
  onboardingStep: number;
  createdAt: Date;
}

export interface TenantWithRole {
  tenant: Tenant;
  role: MembershipRole;
}

export interface TenantStats {
  contacts: number;
  activeContacts: number;
  lists: number;
  segments: number;
  members: number;
}

export interface TenantRepository {
  findBySlug(slug: string): Promise<Tenant | null>;
  /** Rol del usuario en el tenant, o null si no es miembro. */
  findMembershipRole(tenantId: string, userId: string): Promise<MembershipRole | null>;
  listForUser(userId: string): Promise<TenantWithRole[]>;
  listAll(): Promise<Tenant[]>;
  createWithOwner(input: CreateTenantData, ownerUserId: string): Promise<Tenant>;
  update(context: TenantContext, input: UpdateTenantSettingsInput): Promise<Tenant>;
  stats(context: TenantContext): Promise<TenantStats>;
}

/** Slug en minúsculas con guiones: forma parte de la URL (/t/{slug}). */
export const tenantSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const timezoneSchema = z
  .string()
  .max(64)
  .refine((value) => Intl.supportedValuesOf('timeZone').includes(value), 'Zona horaria inválida');

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: tenantSlugSchema,
  defaultLocale: z.enum(SUPPORTED_LOCALES).default('es'),
  timezone: timezoneSchema.default('America/Santo_Domingo'),
});

export type CreateTenantData = z.infer<typeof createTenantSchema>;

export const updateTenantSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  defaultLocale: z.enum(SUPPORTED_LOCALES),
  timezone: timezoneSchema,
  postalAddress: z.string().trim().max(300).nullable(),
});

export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsSchema>;
