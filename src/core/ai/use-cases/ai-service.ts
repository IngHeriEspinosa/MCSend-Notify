/**
 * Puerta única hacia los modelos de IA.
 *
 * 1. Resuelve la configuración del tenant (IA de la plataforma o clave propia descifrada).
 * 2. Comprueba el presupuesto mensual con el coste ya registrado.
 * 3. Llama al modelo y registra el uso (tokens, coste y latencia), también si falla.
 * 4. Traduce los errores del proveedor a códigos de dominio estables que la UI traduce.
 */
import { DomainError } from '@/core/shared/domain-error';
import type { Clock, SecretCipher } from '@/core/shared/ports';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import {
  aiCredentialsAad,
  DEFAULT_OPENAI_BASE_URL,
  monthStartUtc,
  type AiPurpose,
  type AiTier,
} from '../ai';
import {
  isAiModelError,
  type AiConnection,
  type AiSettingsRepository,
  type AiUsageRepository,
  type LanguageModelFactory,
  type PlatformAiConfig,
  type StoredAiSettings,
  type StructuredRequest,
} from '../ports';
import { costMicros, EMPTY_USAGE } from '../pricing';

export interface AiServiceDeps {
  settings: AiSettingsRepository;
  usage: AiUsageRepository;
  factory: LanguageModelFactory;
  cipher: SecretCipher;
  platform: PlatformAiConfig;
  clock: Clock;
}

export interface AiResult<T> {
  value: T;
  model: string;
  costMicros: number;
}

function notConfigured(): never {
  throw new DomainError('INVALID_STATE', 'La IA no está configurada', {
    reason: 'AI_NOT_CONFIGURED',
  });
}

export class AiService {
  constructor(private readonly deps: AiServiceDeps) {}

  /** Presupuesto efectivo en micro-USD: con la IA de plataforma nunca supera el tope global. */
  budgetMicros(settings: StoredAiSettings): number {
    const usd =
      settings.source === 'PLATFORM'
        ? Math.min(settings.monthlyBudgetUsd, this.deps.platform.maxMonthlyBudgetUsd)
        : settings.monthlyBudgetUsd;
    return Math.round(usd * 1_000_000);
  }

  connectionFor(context: TenantContext, settings: StoredAiSettings, tier: AiTier): AiConnection {
    const model =
      tier === 'fast' && settings.fastModel ? settings.fastModel : settings.defaultModel;
    if (settings.source === 'PLATFORM') {
      if (!this.deps.platform.apiKey) notConfigured();
      return { kind: 'ANTHROPIC', apiKey: this.deps.platform.apiKey, baseUrl: null, model };
    }
    const apiKey = settings.credentialsEnc
      ? this.deps.cipher.decrypt(
          settings.credentialsEnc,
          aiCredentialsAad(context.tenantId, settings.id),
        )
      : null;
    const baseUrl =
      settings.kind === 'OPENAI' ? (settings.baseUrl ?? DEFAULT_OPENAI_BASE_URL) : settings.baseUrl;
    return { kind: settings.kind, apiKey: apiKey === '' ? null : apiKey, baseUrl, model };
  }

  async generate<T>(
    context: TenantContext,
    purpose: AiPurpose,
    tier: AiTier,
    request: StructuredRequest<T>,
  ): Promise<AiResult<T>> {
    const settings = await this.deps.settings.find(context);
    if (!settings) notConfigured();

    const now = this.deps.clock.now();
    const spent = await this.deps.usage.spentSince(context, monthStartUtc(now));
    if (spent >= this.budgetMicros(settings)) {
      throw new DomainError('INVALID_STATE', 'Presupuesto de IA agotado', {
        reason: 'AI_BUDGET_EXCEEDED',
      });
    }

    const connection = this.connectionFor(context, settings, tier);
    const model = this.deps.factory.create(connection);
    const prices = {
      inputPricePerMTok: settings.inputPricePerMTok,
      outputPricePerMTok: settings.outputPricePerMTok,
    };
    const started = this.deps.clock.now().getTime();
    const base = { userId: actorUserId(context) ?? null, purpose };

    try {
      const response = await model.generateObject(request);
      const cost = costMicros(response.model, response.usage, prices);
      await this.deps.usage.record(context, {
        ...base,
        ...response.usage,
        model: response.model,
        costMicros: cost,
        latencyMs: this.deps.clock.now().getTime() - started,
        status: 'OK',
      });
      return { value: response.value, model: response.model, costMicros: cost };
    } catch (error) {
      const usage = isAiModelError(error) ? (error.usage ?? EMPTY_USAGE) : EMPTY_USAGE;
      await this.deps.usage.record(context, {
        ...base,
        ...usage,
        model: connection.model,
        costMicros: costMicros(connection.model, usage, prices),
        latencyMs: this.deps.clock.now().getTime() - started,
        status: isAiModelError(error) && error.code === 'REFUSED' ? 'REFUSED' : 'ERROR',
      });
      if (!isAiModelError(error)) throw error;
      if (error.code === 'AUTH' || error.code === 'CONFIG') {
        await this.deps.settings.setStatus(context, 'ERROR', error.message.slice(0, 500), null);
      }
      throw toDomainError(error.code, error.message);
    }
  }
}

function toDomainError(code: string, message: string): DomainError {
  switch (code) {
    case 'AUTH':
      return new DomainError('INVALID_STATE', message, { reason: 'AI_AUTH' });
    case 'CONFIG':
      return new DomainError('INVALID_STATE', message, { reason: 'AI_CONFIG' });
    case 'RATE_LIMITED':
      return new DomainError('RATE_LIMITED', message, { reason: 'AI_PROVIDER_BUSY' });
    case 'REFUSED':
      return new DomainError('VALIDATION', message, { reason: 'AI_REFUSED' });
    case 'TRUNCATED':
    case 'INVALID_OUTPUT':
      return new DomainError('INVALID_STATE', message, { reason: 'AI_INVALID_OUTPUT' });
    default:
      return new DomainError('INVALID_STATE', message, { reason: 'AI_UNAVAILABLE' });
  }
}
