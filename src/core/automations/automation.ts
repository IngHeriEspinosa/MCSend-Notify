/**
 * Automatizaciones recurrentes (p. ej. el resumen semanal de novedades).
 *
 * Pasos fijos y lineales: reunir fuentes → redactar con IA → crear plantilla y campaña →
 * aprobación humana (por defecto) → envío. La programación se expresa con presets (diario,
 * semanal, mensual) que se traducen a cron con la zona horaria del tenant; no se admite cron libre.
 */
import { z } from 'zod';
import { AI_TONES } from '@/core/ai/ai';
import { draftSourceSchema, MAX_SOURCES, type SourceSummary } from '@/core/ai/sources';
import { audienceSchema, type CampaignAudience } from '@/core/campaigns/campaign';
import { SUPPORTED_LOCALES } from '@/core/tenants/tenant';

const hour = z.number().int().min(0).max(23);
const minute = z.number().int().min(0).max(59);

export const automationScheduleSchema = z.discriminatedUnion('frequency', [
  z.object({ frequency: z.literal('daily'), hour, minute }),
  z.object({
    frequency: z.literal('weekly'),
    /** 0 = domingo … 6 = sábado (como cron). */
    weekday: z.number().int().min(0).max(6),
    hour,
    minute,
  }),
  z.object({
    frequency: z.literal('monthly'),
    /** Hasta el 28 para que exista todos los meses. */
    dayOfMonth: z.number().int().min(1).max(28),
    hour,
    minute,
  }),
]);
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;

/** Expresión cron (minuto hora día-mes mes día-semana) equivalente al preset. */
export function cronFor(schedule: AutomationSchedule): string {
  const time = `${schedule.minute} ${schedule.hour}`;
  switch (schedule.frequency) {
    case 'daily':
      return `${time} * * *`;
    case 'weekly':
      return `${time} * * ${schedule.weekday}`;
    case 'monthly':
      return `${time} ${schedule.dayOfMonth} * *`;
  }
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const ON_TIMEOUT_ACTIONS = ['cancel', 'send'] as const;
export type OnTimeoutAction = (typeof ON_TIMEOUT_ACTIONS)[number];
export const MAX_APPROVERS = 5;

export const automationDefinitionSchema = z
  .object({
    sources: z.array(draftSourceSchema).min(1).max(MAX_SOURCES),
    instructions: z.string().trim().max(4000).default(''),
    tone: z.enum(AI_TONES).default('professional'),
    locale: z.enum(SUPPORTED_LOCALES),
    audience: audienceSchema,
    topicId: z.uuid().nullable(),
    senderIdentityId: z.uuid(),
    /** Si está activa, ninguna campaña sale sin que una persona la apruebe. */
    requiresApproval: z.boolean().default(true),
    approverUserIds: z.array(z.uuid()).max(MAX_APPROVERS).default([]),
    approvalTimeoutHours: z.number().int().min(1).max(168).default(48),
    onTimeout: z.enum(ON_TIMEOUT_ACTIONS).default('cancel'),
    /** Sin novedades nuevas, la ejecución se omite (no se envía un correo vacío). */
    skipWhenNoNews: z.boolean().default(true),
  })
  .refine((definition) => !definition.requiresApproval || definition.approverUserIds.length > 0, {
    message: 'APPROVERS_REQUIRED',
    path: ['approverUserIds'],
  });
export type AutomationDefinition = z.infer<typeof automationDefinitionSchema>;

export const automationInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  schedule: automationScheduleSchema,
  timezone: z.string().refine(isValidTimeZone, { message: 'INVALID_TIMEZONE' }),
  definition: automationDefinitionSchema,
});
export type AutomationInput = z.infer<typeof automationInputSchema>;

export const AUTOMATION_RUN_STATUSES = [
  'RUNNING',
  'AWAITING_APPROVAL',
  'SCHEDULED',
  'SKIPPED',
  'REJECTED',
  'EXPIRED',
  'FAILED',
] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface AutomationRecord {
  id: string;
  name: string;
  enabled: boolean;
  schedule: AutomationSchedule;
  timezone: string;
  definition: AutomationDefinition;
  createdById: string;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationSummary {
  id: string;
  name: string;
  enabled: boolean;
  schedule: AutomationSchedule;
  timezone: string;
  lastRunAt: Date | null;
  lastRunStatus: AutomationRunStatus | null;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  idempotencyKey: string;
  trigger: 'schedule' | 'manual';
  status: AutomationRunStatus;
  campaignId: string | null;
  templateId: string | null;
  sources: SourceSummary[];
  removedLinks: string[];
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  approval: { id: string; status: ApprovalStatus; expiresAt: Date } | null;
}

export interface ApprovalRecord {
  id: string;
  runId: string;
  campaignId: string;
  automationId: string;
  automationName: string;
  approverUserIds: string[];
  status: ApprovalStatus;
  onTimeout: OnTimeoutAction;
  expiresAt: Date;
  decidedById: string | null;
  decidedAt: Date | null;
  comment: string | null;
  createdAt: Date;
}

/** Datos para crear la campaña a partir de la definición. */
export function campaignPatchFor(
  definition: AutomationDefinition,
  templateId: string,
  name: string,
): {
  name: string;
  templateId: string;
  audience: CampaignAudience;
  topicId: string | null;
  senderIdentityId: string;
  subjectB: null;
  trackOpens: boolean;
  trackClicks: boolean;
  throttlePerHour: null;
} {
  return {
    name,
    templateId,
    audience: definition.audience,
    topicId: definition.topicId,
    senderIdentityId: definition.senderIdentityId,
    subjectB: null,
    trackOpens: true,
    trackClicks: true,
    throttlePerHour: null,
  };
}
