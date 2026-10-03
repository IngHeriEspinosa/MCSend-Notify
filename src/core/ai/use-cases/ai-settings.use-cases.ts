/**
 * Configuración de IA del tenant: guardar (la clave se cifra con AAD por fila y nunca se
 * devuelve), probar la conexión con una llamada mínima, desactivar y consultar el uso del mes.
 */
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError, isDomainError } from '@/core/shared/domain-error';
import type { Clock, IdGenerator, SecretCipher } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { aiCredentialsAad, monthStartUtc, type AiSettingsInput, type AiSettingsView } from '../ai';
import type { AiSettingsRepository, AiUsageRepository, PlatformAiConfig } from '../ports';
import { connectionTestSchema, systemPrompt } from '../prompts';
import type { AiService } from './ai-service';

export interface AiSettingsUseCaseDeps {
  settings: AiSettingsRepository;
  usage: AiUsageRepository;
  ai: AiService;
  cipher: SecretCipher;
  platform: PlatformAiConfig;
  audit: AuditLogger;
  clock: Clock;
  ids: IdGenerator;
}

export interface AiOverview {
  settings: AiSettingsView | null;
  platformAvailable: boolean;
  platformMaxBudgetUsd: number;
  budgetMicros: number;
  usage: Awaited<ReturnType<AiUsageRepository['summary']>>;
}

export class ManageAiSettingsUseCase {
  constructor(private readonly deps: AiSettingsUseCaseDeps) {}

  /** Configuración (sin secretos), disponibilidad de la IA de plataforma y uso del mes. */
  async overview(context: TenantContext): Promise<AiOverview> {
    assertCan(context, 'ai:manage');
    const stored = await this.deps.settings.find(context);
    const usage = await this.deps.usage.summary(context, monthStartUtc(this.deps.clock.now()));
    return {
      settings: stored ? withoutSecret(stored) : null,
      platformAvailable: this.deps.platform.apiKey !== null,
      platformMaxBudgetUsd: this.deps.platform.maxMonthlyBudgetUsd,
      budgetMicros: stored ? this.deps.ai.budgetMicros(stored) : 0,
      usage,
    };
  }

  /** Indica si la IA está disponible para el tenant (para mostrar u ocultar acciones). */
  async isEnabled(context: TenantContext): Promise<boolean> {
    const stored = await this.deps.settings.find(context);
    if (!stored) return false;
    return stored.source === 'OWN' || this.deps.platform.apiKey !== null;
  }

  async save(context: TenantContext, input: AiSettingsInput): Promise<AiSettingsView> {
    assertCan(context, 'ai:manage');
    const current = await this.deps.settings.find(context);
    const id = current?.id ?? this.deps.ids.uuid();

    if (input.source === 'PLATFORM') {
      if (input.monthlyBudgetUsd > this.deps.platform.maxMonthlyBudgetUsd) {
        throw new DomainError('VALIDATION', 'Presupuesto superior al permitido', {
          field: 'monthlyBudgetUsd',
          reason: 'AI_BUDGET_ABOVE_PLATFORM',
          max: this.deps.platform.maxMonthlyBudgetUsd,
        });
      }
      const saved = await this.deps.settings.save(context, id, {
        source: 'PLATFORM',
        kind: 'ANTHROPIC',
        credentialsEnc: null,
        baseUrl: null,
        defaultModel: input.defaultModel,
        fastModel: input.fastModel,
        monthlyBudgetUsd: input.monthlyBudgetUsd,
        inputPricePerMTok: null,
        outputPricePerMTok: null,
      });
      await this.audit(context, saved.id, { source: 'PLATFORM', keyChanged: false });
      return withoutSecret(saved);
    }

    const keepKey =
      input.apiKey === null && current?.source === 'OWN' && current.kind === input.kind;
    if (input.apiKey === null && !keepKey && input.kind !== 'OPENAI_COMPATIBLE') {
      throw new DomainError('VALIDATION', 'Falta la clave de API', { field: 'apiKey' });
    }
    const credentialsEnc = keepKey
      ? (current?.credentialsEnc ?? null)
      : input.apiKey
        ? this.deps.cipher.encrypt(input.apiKey, aiCredentialsAad(context.tenantId, id))
        : null;
    const saved = await this.deps.settings.save(context, id, {
      source: 'OWN',
      kind: input.kind,
      credentialsEnc,
      baseUrl: input.kind === 'ANTHROPIC' ? null : input.baseUrl,
      defaultModel: input.defaultModel,
      fastModel: input.fastModel,
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      inputPricePerMTok: input.inputPricePerMTok,
      outputPricePerMTok: input.outputPricePerMTok,
    });
    await this.audit(context, saved.id, { source: 'OWN', kind: input.kind, keyChanged: !keepKey });
    return withoutSecret(saved);
  }

  /** Llamada mínima con salida estructurada: valida clave, modelo y formato de respuesta. */
  async verify(context: TenantContext): Promise<{ ok: true } | { ok: false; reason: string }> {
    assertCan(context, 'ai:manage');
    try {
      await this.deps.ai.generate(context, 'connection_test', 'default', {
        system: systemPrompt('MC Send Notify', 'You answer connectivity checks.'),
        prompt: 'Reply with {"ok": true}.',
        schema: connectionTestSchema,
        schemaName: 'connection_test',
        maxOutputTokens: 2000,
        effort: 'low',
      });
      await this.deps.settings.setStatus(context, 'ACTIVE', null, this.deps.clock.now());
      return { ok: true };
    } catch (error) {
      if (!isDomainError(error)) throw error;
      const reason = typeof error.details?.reason === 'string' ? error.details.reason : error.code;
      return { ok: false, reason };
    }
  }

  async disable(context: TenantContext): Promise<void> {
    assertCan(context, 'ai:manage');
    if (!(await this.deps.settings.delete(context))) {
      throw new DomainError('NOT_FOUND', 'La IA no está configurada');
    }
    await this.deps.audit.record(context, { action: 'ai.disabled', entityType: 'ai_settings' });
  }

  private audit(context: TenantContext, id: string, metadata: Record<string, unknown>) {
    return this.deps.audit.record(context, {
      action: 'ai.configured',
      entityType: 'ai_settings',
      entityId: id,
      metadata,
    });
  }
}

function withoutSecret(stored: AiSettingsView & { credentialsEnc: string | null }): AiSettingsView {
  const { credentialsEnc: _secret, ...view } = stored;
  return view;
}
