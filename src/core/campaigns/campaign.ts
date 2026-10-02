/**
 * Campaña: estados, transiciones permitidas, audiencia y esquemas de entrada.
 *
 * DRAFT → SCHEDULED → DISPATCHING → SENDING → SENT
 *                 ↘ DRAFT (desprogramar)   ↘ PAUSED ↔ (DISPATCHING | SENDING)
 * Cualquier estado activo → CANCELLED. Un error irrecuperable al despachar → FAILED.
 */
import { z } from 'zod';
import type { TemplateBody } from '@/core/templates/email-content';
import type { TemplateIssue, TemplateIssueSeverity } from '@/core/templates/template-issues';

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'DISPATCHING',
  'SENDING',
  'PAUSED',
  'SENT',
  'CANCELLED',
  'FAILED',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  DRAFT: ['SCHEDULED'],
  SCHEDULED: ['DRAFT', 'DISPATCHING', 'CANCELLED'],
  DISPATCHING: ['SENDING', 'PAUSED', 'CANCELLED', 'FAILED'],
  SENDING: ['SENT', 'PAUSED', 'CANCELLED'],
  PAUSED: ['DISPATCHING', 'SENDING', 'CANCELLED'],
  SENT: [],
  CANCELLED: [],
  FAILED: [],
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isActiveCampaign(status: CampaignStatus): boolean {
  return status === 'DISPATCHING' || status === 'SENDING';
}

/** A partir de este número de destinatarios hay que confirmar escribiendo la cifra exacta. */
export const SEND_CONFIRMATION_THRESHOLD = 500;
export const MAX_TEST_RECIPIENTS = 5;

export const audienceSchema = z.object({
  listIds: z.array(z.uuid()).max(50).default([]),
  segmentIds: z.array(z.uuid()).max(50).default([]),
  excludeListIds: z.array(z.uuid()).max(50).default([]),
});
export type CampaignAudience = z.infer<typeof audienceSchema>;

export function isEmptyAudience(audience: CampaignAudience): boolean {
  return audience.listIds.length === 0 && audience.segmentIds.length === 0;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  scheduledAt: Date | null;
  recipientCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignRecord extends CampaignSummary {
  templateId: string | null;
  templateVersion: number | null;
  /** Copia del cuerpo de la plantilla al programar (null en borrador). */
  body: TemplateBody | null;
  subjectB: string | null;
  senderIdentityId: string | null;
  topicId: string | null;
  audience: CampaignAudience;
  throttlePerHour: number | null;
  trackOpens: boolean;
  trackClicks: boolean;
  version: number;
  dispatchCursor: string | null;
  dispatchedAt: Date | null;
  error: string | null;
  createdById: string;
}

const optionalSubject = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === '' ? null : value))
  .nullable();

export const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  templateId: z.uuid(),
});

export const updateCampaignSchema = z.object({
  campaignId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  name: z.string().trim().min(2).max(120),
  templateId: z.uuid(),
  audience: audienceSchema,
  topicId: z.uuid().nullable(),
  senderIdentityId: z.uuid().nullable(),
  subjectB: optionalSubject,
  trackOpens: z.boolean(),
  trackClicks: z.boolean(),
  throttlePerHour: z.number().int().min(10).max(1_000_000).nullable(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const scheduleCampaignSchema = z.object({
  campaignId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  /** null = enviar ahora. */
  scheduledAt: z.coerce.date().nullable(),
  /** Número de destinatarios escrito por la persona (obligatorio por encima del umbral). */
  confirmRecipients: z.number().int().min(0).nullable(),
});

export const sendTestSchema = z.object({
  campaignId: z.uuid(),
  emails: z.array(z.email().max(254)).min(1).max(MAX_TEST_RECIPIENTS),
});

/** Variante A/B determinista por contacto (reparto estable 50/50). */
export function variantFor(contactId: string): 'A' | 'B' {
  const lastHex = contactId.replace(/-/g, '').slice(-2);
  return Number.parseInt(lastHex, 16) % 2 === 0 ? 'A' : 'B';
}

export const CAMPAIGN_ISSUE_CODES = [
  'SENDER_MISSING',
  'SENDER_DNS',
  'PROVIDER_ERROR',
  'NO_RECIPIENTS',
  'TEMPLATE_MISSING',
] as const;
export type CampaignIssueCode = (typeof CAMPAIGN_ISSUE_CODES)[number];

export type CampaignIssue =
  | TemplateIssue
  | { code: CampaignIssueCode; severity: TemplateIssueSeverity; detail?: string | undefined };
