import { describe, expect, it } from 'vitest';
import { costMicros } from '@/core/ai/pricing';
import { automationDefinitionSchema, automationInputSchema, cronFor } from './automation';

const definition = {
  sources: [{ kind: 'changelog' }],
  locale: 'es',
  audience: { listIds: ['55555555-5555-7555-8555-555555555555'] },
  topicId: null,
  senderIdentityId: '33333333-3333-7333-8333-333333333333',
  approverUserIds: ['77777777-7777-7777-8777-777777777777'],
};

describe('programación de automatizaciones', () => {
  it('traduce los presets a cron', () => {
    expect(cronFor({ frequency: 'daily', hour: 8, minute: 30 })).toBe('30 8 * * *');
    expect(cronFor({ frequency: 'weekly', weekday: 1, hour: 9, minute: 0 })).toBe('0 9 * * 1');
    expect(cronFor({ frequency: 'monthly', dayOfMonth: 1, hour: 7, minute: 15 })).toBe(
      '15 7 1 * *',
    );
  });

  it('valida la zona horaria y exige aprobadores si la aprobación está activa', () => {
    const input = {
      name: 'Resumen semanal',
      schedule: { frequency: 'weekly', weekday: 1, hour: 9, minute: 0 },
      timezone: 'America/Santo_Domingo',
      definition,
    };
    expect(automationInputSchema.safeParse(input).success).toBe(true);
    expect(automationInputSchema.safeParse({ ...input, timezone: 'Marte/Olympus' }).success).toBe(
      false,
    );
    const parsed = automationDefinitionSchema.parse(definition);
    expect(parsed).toMatchObject({
      requiresApproval: true,
      onTimeout: 'cancel',
      tone: 'professional',
    });
    expect(
      automationDefinitionSchema.safeParse({ ...definition, approverUserIds: [] }).success,
    ).toBe(false);
    expect(
      automationDefinitionSchema.safeParse({
        ...definition,
        approverUserIds: [],
        requiresApproval: false,
      }).success,
    ).toBe(true);
  });
});

describe('costes de IA', () => {
  it('calcula micro-USD con la tarifa del modelo, también con ids fechados', () => {
    const usage = {
      inputTokens: 10_000,
      outputTokens: 2_000,
      cacheReadTokens: 5_000,
      cacheWriteTokens: 0,
    };
    // Opus 5.5: 10.000×4 + 2.000×20 + 5.000×0,2 = 81.000 µUSD
    expect(costMicros('claude-opus-5-5', usage)).toBe(81_000);
    expect(costMicros('claude-haiku-4-5-20251001', usage)).toBe(10_000 + 10_000 + 500);
    expect(costMicros('llama3.1', usage)).toBe(0);
    expect(costMicros('llama3.1', usage, { inputPricePerMTok: 1, outputPricePerMTok: 2 })).toBe(
      10_000 + 4_000 + 5_000,
    );
  });
});
