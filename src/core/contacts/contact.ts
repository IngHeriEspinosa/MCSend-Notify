/** Entidad Contacto: tipos de lectura y esquema de escritura (validado con Zod). */
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '@/core/tenants/tenant';
import type { AttributeValue } from './contact-fields';

export const CONTACT_STATUSES = [
  'ACTIVE',
  'UNSUBSCRIBED',
  'BOUNCED',
  'COMPLAINED',
  'INVALID',
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_SOURCES = ['manual', 'import', 'api'] as const;

export type ContactSource = (typeof CONTACT_SOURCES)[number];

export interface ContactSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  status: ContactStatus;
  source: string;
  createdAt: Date;
}

export interface ContactDetail extends ContactSummary {
  locale: string | null;
  timezone: string | null;
  externalId: string | null;
  attributes: Record<string, AttributeValue>;
  consentAt: Date | null;
  consentSource: string | null;
  listIds: string[];
  tagIds: string[];
  /** topicId → suscrito. Los temas sin entrada usan su valor por defecto. */
  topicSubscriptions: Record<string, boolean>;
  updatedAt: Date;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const contactInputSchema = z.object({
  email: z.email().max(254),
  firstName: optionalText(100),
  lastName: optionalText(100),
  company: optionalText(200),
  locale: z.enum(SUPPORTED_LOCALES).nullable().optional(),
  timezone: optionalText(64),
  externalId: optionalText(128),
  status: z.enum(CONTACT_STATUSES).optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  listIds: z.array(z.uuid()).max(100).optional(),
  tagIds: z.array(z.uuid()).max(100).optional(),
  topicSubscriptions: z.record(z.uuid(), z.boolean()).optional(),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

/** Datos ya normalizados que se persisten. */
export interface ContactWriteData {
  email: string;
  emailNormalized: string;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  company?: string | null | undefined;
  locale?: string | null | undefined;
  timezone?: string | null | undefined;
  externalId?: string | null | undefined;
  status?: ContactStatus | undefined;
  attributes: Record<string, AttributeValue>;
  source?: ContactSource | undefined;
  consentAt?: Date | null | undefined;
  consentSource?: string | null | undefined;
}

export const CONTACT_SORT_FIELDS = [
  'createdAt',
  'email',
  'firstName',
  'lastName',
  'company',
] as const;

export const contactQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
  listId: z.uuid().optional(),
  tagId: z.uuid().optional(),
  segmentId: z.uuid().optional(),
  sortField: z.enum(CONTACT_SORT_FIELDS).default('createdAt'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export type ContactQuery = z.infer<typeof contactQuerySchema>;
