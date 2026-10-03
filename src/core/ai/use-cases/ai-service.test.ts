import { beforeEach, describe, expect, it } from 'vitest';
import {
  aiSettings,
  FakeLanguageModelFactory,
  InMemoryAiSettingsRepository,
  InMemoryAiUsageRepository,
  reversibleCipher,
} from '@tests/fakes/ai.fakes';
import { FakeClock } from '@tests/fakes/identity.fakes';
import { ownerContext } from '@tests/fakes/sending.fakes';
import { z } from 'zod';
import { AiModelError } from '../ports';
import { AiService } from './ai-service';

const request = {
  system: 'sys',
  prompt: 'p',
  schema: z.object({ ok: z.boolean() }),
  schemaName: 'test',
  maxOutputTokens: 1000,
  effort: 'low' as const,
};

let settings: InMemoryAiSettingsRepository;
let usage: InMemoryAiUsageRepository;
let factory: FakeLanguageModelFactory;
let platformKey: string | null;

const service = () =>
  new AiService({
    settings,
    usage,
    factory,
    cipher: reversibleCipher,
    platform: { apiKey: platformKey, maxMonthlyBudgetUsd: 5 },
    clock: new FakeClock(),
  });

beforeEach(() => {
  settings = new InMemoryAiSettingsRepository();
  usage = new InMemoryAiUsageRepository();
  factory = new FakeLanguageModelFactory();
  platformKey = null;
});

describe('AiService', () => {
  it('descifra la clave del tenant, llama al modelo y registra tokens y coste', async () => {
    factory.respond({ ok: true });
    const result = await service().generate(
      ownerContext,
      'subject_suggestions',
      'default',
      request,
    );
    expect(result.value).toEqual({ ok: true });
    expect(factory.requests[0]?.connection).toMatchObject({
      kind: 'ANTHROPIC',
      apiKey: 'sk-ant-test',
      model: 'claude-opus-5-5',
    });
    // Opus 5.5: 1.000 × 4 + 500 × 20 = 14.000 µUSD
    expect(usage.entries[0]).toMatchObject({
      purpose: 'subject_suggestions',
      userId: 'user-1',
      status: 'OK',
      costMicros: 14_000,
      inputTokens: 1000,
    });
  });

  it('usa el modelo rápido en las tareas cortas', async () => {
    factory.respond({ ok: true });
    await service().generate(ownerContext, 'subject_suggestions', 'fast', request);
    expect(factory.requests[0]?.connection.model).toBe('claude-haiku-4-5');
  });

  it('rechaza la llamada si el presupuesto del mes está agotado', async () => {
    usage.spent = 10_000_000; // 10 USD = presupuesto
    await expect(
      service().generate(ownerContext, 'campaign_draft', 'default', request),
    ).rejects.toMatchObject({ details: { reason: 'AI_BUDGET_EXCEEDED' } });
    expect(factory.requests).toHaveLength(0);
  });

  it('con la IA de plataforma el presupuesto nunca supera el tope global', async () => {
    settings.settings = aiSettings({
      source: 'PLATFORM',
      credentialsEnc: null,
      monthlyBudgetUsd: 50,
    });
    expect(service().budgetMicros(settings.settings)).toBe(5_000_000);
    await expect(
      service().generate(ownerContext, 'campaign_draft', 'default', request),
    ).rejects.toMatchObject({ details: { reason: 'AI_NOT_CONFIGURED' } });
    platformKey = 'sk-platform';
    factory.respond({ ok: true });
    await service().generate(ownerContext, 'campaign_draft', 'default', request);
    expect(factory.requests[0]?.connection.apiKey).toBe('sk-platform');
  });

  it('sin configuración la IA está desactivada', async () => {
    settings.settings = null;
    await expect(
      service().generate(ownerContext, 'campaign_draft', 'default', request),
    ).rejects.toMatchObject({ code: 'INVALID_STATE', details: { reason: 'AI_NOT_CONFIGURED' } });
  });

  it('registra el coste de una negativa y la traduce a un código de dominio', async () => {
    factory.fail(
      new AiModelError('REFUSED', 'no', {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    );
    await expect(
      service().generate(ownerContext, 'campaign_draft', 'default', request),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { reason: 'AI_REFUSED' } });
    expect(usage.entries[0]).toMatchObject({ status: 'REFUSED', costMicros: 600 });
  });

  it('una clave rechazada deja la configuración en error', async () => {
    factory.fail(new AiModelError('AUTH', 'invalid x-api-key'));
    await expect(
      service().generate(ownerContext, 'campaign_draft', 'default', request),
    ).rejects.toMatchObject({ details: { reason: 'AI_AUTH' } });
    expect(settings.settings).toMatchObject({ status: 'ERROR', lastError: 'invalid x-api-key' });
    expect(usage.entries[0]?.status).toBe('ERROR');
  });
});
