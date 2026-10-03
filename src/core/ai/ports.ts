/**
 * Puertos de IA. El dominio pide objetos estructurados validados con Zod; los adaptadores
 * (Claude con el SDK oficial, OpenAI-compatible por HTTP) traducen a cada API.
 */
import type { z } from 'zod';
import type { ProviderStatus } from '@/core/providers/provider-config';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { AiProviderKind, AiPurpose, AiSettingsView, AiSource } from './ai';
import type { TokenUsage } from './pricing';

/** Profundidad de razonamiento (Claude `output_config.effort`); otros proveedores la ignoran. */
export type AiEffort = 'low' | 'medium' | 'high';

export interface StructuredRequest<T> {
  /** Instrucciones estables (se cachean en Claude): reglas, marca y formato. */
  system: string;
  /** Petición concreta: fuentes envueltas como datos y lo que se pide. */
  prompt: string;
  /** Esquema plano (sin transformaciones) que la API debe respetar y que se valida al recibirlo. */
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
  effort: AiEffort;
}

export interface StructuredResponse<T> {
  value: T;
  model: string;
  usage: TokenUsage;
}

export interface LanguageModel {
  readonly model: string;
  generateObject<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

export interface AiConnection {
  kind: AiProviderKind;
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
}

export interface LanguageModelFactory {
  create(connection: AiConnection): LanguageModel;
}

export const AI_MODEL_ERROR_CODES = [
  /** Clave inválida o sin permisos. */
  'AUTH',
  /** El proveedor limitó la petición (429). */
  'RATE_LIMITED',
  /** El modelo se negó a responder (`stop_reason: refusal`). */
  'REFUSED',
  /** La respuesta se cortó por el límite de tokens. */
  'TRUNCATED',
  /** La respuesta no cumple el esquema. */
  'INVALID_OUTPUT',
  /** Error de red o del servidor del proveedor. */
  'UNAVAILABLE',
  /** Petición rechazada por configuración (modelo inexistente, URL bloqueada...). */
  'CONFIG',
] as const;
export type AiModelErrorCode = (typeof AI_MODEL_ERROR_CODES)[number];

const AI_MODEL_ERROR_BRAND = Symbol.for('mc-send-notify.AiModelError');

/** Error de un adaptador de IA. Lleva el uso consumido, si lo hubo, para registrar el coste. */
export class AiModelError extends Error {
  readonly [AI_MODEL_ERROR_BRAND] = true;

  constructor(
    readonly code: AiModelErrorCode,
    message: string,
    readonly usage?: TokenUsage,
  ) {
    super(message);
    this.name = 'AiModelError';
  }
}

export function isAiModelError(error: unknown): error is AiModelError {
  if (error instanceof AiModelError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    AI_MODEL_ERROR_BRAND in error &&
    error[AI_MODEL_ERROR_BRAND] === true
  );
}

export interface StoredAiSettings extends AiSettingsView {
  credentialsEnc: string | null;
}

export interface AiSettingsWrite {
  source: AiSource;
  kind: AiProviderKind;
  credentialsEnc: string | null;
  baseUrl: string | null;
  defaultModel: string;
  fastModel: string | null;
  monthlyBudgetUsd: number;
  inputPricePerMTok: number | null;
  outputPricePerMTok: number | null;
}

export interface AiSettingsRepository {
  find(context: TenantContext): Promise<StoredAiSettings | null>;
  /** Crea o reemplaza la configuración; incrementa `configVersion` y la deja ACTIVE. */
  save(context: TenantContext, id: string, write: AiSettingsWrite): Promise<StoredAiSettings>;
  setStatus(
    context: TenantContext,
    status: ProviderStatus,
    lastError: string | null,
    verifiedAt: Date | null,
  ): Promise<void>;
  delete(context: TenantContext): Promise<boolean>;
}

export type AiUsageStatus = 'OK' | 'ERROR' | 'REFUSED';

export interface NewAiUsage extends TokenUsage {
  userId: string | null;
  purpose: AiPurpose;
  model: string;
  costMicros: number;
  latencyMs: number;
  status: AiUsageStatus;
}

export interface AiUsageByPurpose {
  purpose: string;
  calls: number;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageSummary {
  since: Date;
  calls: number;
  errors: number;
  costMicros: number;
  byPurpose: AiUsageByPurpose[];
}

export interface AiUsageRepository {
  record(context: TenantContext, entry: NewAiUsage): Promise<void>;
  /** Coste acumulado desde `since` (base del presupuesto mensual). */
  spentSince(context: TenantContext, since: Date): Promise<number>;
  summary(context: TenantContext, since: Date): Promise<AiUsageSummary>;
}

/** IA de la plataforma: clave común y tope de presupuesto mensual por tenant. */
export interface PlatformAiConfig {
  apiKey: string | null;
  maxMonthlyBudgetUsd: number;
}
