/**
 * Configuración de IA de un tenant: IA de la plataforma (Claude con la clave de la plataforma y un
 * presupuesto acotado) o clave propia (Anthropic, OpenAI o una API compatible con OpenAI como
 * Ollama). Sin configuración, las funciones de IA quedan desactivadas.
 */
import { z } from 'zod';
import type { ProviderStatus } from '@/core/providers/provider-config';

export const AI_SOURCES = ['PLATFORM', 'OWN'] as const;
export type AiSource = (typeof AI_SOURCES)[number];

export const AI_PROVIDER_KINDS = ['ANTHROPIC', 'OPENAI', 'OPENAI_COMPATIBLE'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** Modelos de Claude admitidos con la IA de la plataforma (identificadores exactos de la API). */
export const ANTHROPIC_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-4-5',
] as const;
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];

export const DEFAULT_AI_MODEL: AnthropicModel = 'claude-opus-5-5';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Para qué se usa cada llamada: aparece en el registro de uso y en el panel de costes. */
export const AI_PURPOSES = [
  'campaign_draft',
  'subject_suggestions',
  'translation',
  'tone',
  'segment',
  'results_summary',
  'connection_test',
] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

/** `fast` usa el modelo rápido del tenant si lo tiene (tareas cortas y de bajo riesgo). */
export type AiTier = 'default' | 'fast';

export const MAX_MONTHLY_BUDGET_USD = 100_000;

const modelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._:/-]+$/, 'INVALID_MODEL');

const budgetSchema = z.number().min(0).max(MAX_MONTHLY_BUDGET_USD);
const priceSchema = z.number().min(0).max(1000).nullable();

export const aiSettingsInputSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('PLATFORM'),
    defaultModel: z.enum(ANTHROPIC_MODELS),
    fastModel: z.enum(ANTHROPIC_MODELS).nullable(),
    monthlyBudgetUsd: budgetSchema,
  }),
  z
    .object({
      source: z.literal('OWN'),
      kind: z.enum(AI_PROVIDER_KINDS),
      /** null conserva la clave guardada; '' indica que el servidor no necesita clave (Ollama). */
      apiKey: z.string().trim().max(500).nullable(),
      baseUrl: z
        .url({ protocol: /^https?$/ })
        .max(500)
        .nullable(),
      defaultModel: modelNameSchema,
      fastModel: modelNameSchema.nullable(),
      monthlyBudgetUsd: budgetSchema,
      inputPricePerMTok: priceSchema,
      outputPricePerMTok: priceSchema,
    })
    .refine((input) => input.kind !== 'OPENAI_COMPATIBLE' || input.baseUrl !== null, {
      message: 'BASE_URL_REQUIRED',
      path: ['baseUrl'],
    })
    .refine((input) => input.kind === 'OPENAI_COMPATIBLE' || input.apiKey !== '', {
      message: 'API_KEY_REQUIRED',
      path: ['apiKey'],
    }),
]);

export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

/** Configuración visible en la interfaz: nunca incluye la clave. */
export interface AiSettingsView {
  id: string;
  source: AiSource;
  kind: AiProviderKind;
  hasApiKey: boolean;
  baseUrl: string | null;
  defaultModel: string;
  fastModel: string | null;
  monthlyBudgetUsd: number;
  inputPricePerMTok: number | null;
  outputPricePerMTok: number | null;
  status: ProviderStatus;
  lastError: string | null;
  lastVerifiedAt: Date | null;
  configVersion: number;
}

export function aiCredentialsAad(tenantId: string, settingsId: string): string {
  return `${tenantId}:ai_settings:${settingsId}`;
}

/** Inicio del mes natural en UTC: el presupuesto se reinicia el día 1 a las 00:00 UTC. */
export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const AI_TONES = ['professional', 'friendly', 'concise', 'enthusiastic'] as const;
export type AiTone = (typeof AI_TONES)[number];
