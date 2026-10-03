import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { StructuredRequest } from '@/core/ai/ports';
import type { SafeResponse } from '../security/safe-fetch';
import { AnthropicLanguageModel } from './anthropic.language-model';
import {
  OpenAiCompatibleLanguageModel,
  strictJsonSchema,
} from './openai-compatible.language-model';

const schema = z.object({ subject: z.string(), level: z.number().int() });
const request: StructuredRequest<z.infer<typeof schema>> = {
  system: 'Reglas',
  prompt: 'Redacta',
  schema,
  schemaName: 'draft',
  maxOutputTokens: 4000,
  effort: 'medium',
};

function anthropicWith(response: { status: number; body: unknown }) {
  const calls: Array<Record<string, unknown>> = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = new Anthropic({ apiKey: 'sk-ant-test', fetch, maxRetries: 0 });
  return { calls, model: (name: string) => new AnthropicLanguageModel(client, name) };
}

const message = (overrides: Record<string, unknown>) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: '{"subject":"Hola","level":1}' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    input_tokens: 120,
    output_tokens: 40,
    cache_read_input_tokens: 800,
    cache_creation_input_tokens: 0,
  },
  ...overrides,
});

describe('AnthropicLanguageModel (SDK oficial)', () => {
  it('pide salida estructurada con esfuerzo y caché, sin parámetros de muestreo', async () => {
    const { calls, model } = anthropicWith({ status: 200, body: message({}) });
    const result = await model('claude-opus-5-5').generateObject(request);
    expect(result).toEqual({
      value: { subject: 'Hola', level: 1 },
      model: 'claude-opus-5-5',
      usage: { inputTokens: 120, outputTokens: 40, cacheReadTokens: 800, cacheWriteTokens: 0 },
    });
    const body = calls[0] ?? {};
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      system: [{ type: 'text', text: 'Reglas', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Redacta' }],
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('tool_choice');
  });

  it('no envía effort a modelos que no lo admiten (Haiku 4.5)', async () => {
    const { calls, model } = anthropicWith({
      status: 200,
      body: message({ model: 'claude-haiku-4-5' }),
    });
    await model('claude-haiku-4-5').generateObject(request);
    expect(calls[0]?.output_config).not.toHaveProperty('effort');
  });

  it('una negativa o un corte por tokens son errores tipados que conservan el uso', async () => {
    const refused = anthropicWith({
      status: 200,
      body: message({ stop_reason: 'refusal', content: [] }),
    });
    await expect(refused.model('claude-opus-5-5').generateObject(request)).rejects.toMatchObject({
      code: 'REFUSED',
      usage: { inputTokens: 120 },
    });
    const truncated = anthropicWith({
      status: 200,
      body: message({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"subj' }] }),
    });
    await expect(truncated.model('claude-opus-5-5').generateObject(request)).rejects.toMatchObject({
      code: 'TRUNCATED',
    });
    const invalid = anthropicWith({
      status: 200,
      body: message({ content: [{ type: 'text', text: '{"subject":1}' }] }),
    });
    await expect(invalid.model('claude-opus-5-5').generateObject(request)).rejects.toMatchObject({
      code: 'INVALID_OUTPUT',
    });
  });

  it('traduce los errores HTTP del SDK', async () => {
    const auth = anthropicWith({
      status: 401,
      body: {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
    });
    await expect(auth.model('claude-opus-5-5').generateObject(request)).rejects.toMatchObject({
      code: 'AUTH',
    });
    const busy = anthropicWith({
      status: 429,
      body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
    });
    await expect(busy.model('claude-opus-5-5').generateObject(request)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    const model404 = anthropicWith({
      status: 404,
      body: { type: 'error', error: { type: 'not_found_error', message: 'model' } },
    });
    await expect(model404.model('claude-nope').generateObject(request)).rejects.toMatchObject({
      code: 'CONFIG',
    });
  });
});

function openAiWith(status: number, body: unknown) {
  const calls: Array<{
    url: string;
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }> = [];
  const fetcher = async (
    url: string,
    options: { body?: string; headers?: Record<string, string> } = {},
  ): Promise<SafeResponse> => {
    calls.push({
      url,
      body: JSON.parse(options.body ?? '{}') as Record<string, unknown>,
      headers: options.headers ?? {},
    });
    return {
      url,
      status,
      contentType: 'application/json',
      headers: {},
      body: Buffer.from(JSON.stringify(body)),
    };
  };
  return { calls, fetcher };
}

describe('OpenAiCompatibleLanguageModel', () => {
  it('usa JSON Schema estricto y registra los tokens en caché', async () => {
    const { calls, fetcher } = openAiWith(200, {
      model: 'llama3.1',
      choices: [{ finish_reason: 'stop', message: { content: '{"subject":"Hi","level":2}' } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 30 },
      },
    });
    const model = new OpenAiCompatibleLanguageModel({
      baseUrl: 'http://ollama:11434/v1/',
      apiKey: null,
      model: 'llama3.1',
      flavor: 'compatible',
      allowPrivate: true,
      fetcher,
    });
    const result = await model.generateObject(request);
    expect(result.value).toEqual({ subject: 'Hi', level: 2 });
    expect(result.usage).toEqual({
      inputTokens: 70,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 0,
    });
    expect(calls[0]?.url).toBe('http://ollama:11434/v1/chat/completions');
    expect(calls[0]?.headers).not.toHaveProperty('authorization');
    expect(calls[0]?.body).toMatchObject({
      max_tokens: 4000,
      response_format: { type: 'json_schema', json_schema: { name: 'draft', strict: true } },
    });
  });

  it('OpenAI usa max_completion_tokens y la clave como Bearer; mapea errores', async () => {
    const ok = openAiWith(200, {
      choices: [{ finish_reason: 'stop', message: { content: '{"subject":"x","level":1}' } }],
    });
    await new OpenAiCompatibleLanguageModel({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-x',
      flavor: 'openai',
      allowPrivate: false,
      fetcher: ok.fetcher,
    }).generateObject(request);
    expect(ok.calls[0]?.body).toHaveProperty('max_completion_tokens', 4000);
    expect(ok.calls[0]?.headers.authorization).toBe('Bearer sk-test');

    const cases: Array<[number, unknown, string]> = [
      [401, {}, 'AUTH'],
      [429, {}, 'RATE_LIMITED'],
      [503, {}, 'UNAVAILABLE'],
      [400, {}, 'CONFIG'],
      [200, { choices: [{ finish_reason: 'stop', message: { refusal: 'no' } }] }, 'REFUSED'],
      [200, { choices: [{ finish_reason: 'length', message: { content: '{' } }] }, 'TRUNCATED'],
    ];
    for (const [status, body, code] of cases) {
      const { fetcher } = openAiWith(status, body);
      await expect(
        new OpenAiCompatibleLanguageModel({
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'k',
          model: 'm',
          flavor: 'openai',
          allowPrivate: false,
          fetcher,
        }).generateObject(request),
      ).rejects.toMatchObject({ code });
    }
  });

  it('genera esquemas estrictos: objetos cerrados y todas las propiedades obligatorias', () => {
    expect(
      strictJsonSchema(z.object({ a: z.string(), b: z.object({ c: z.number() }) })),
    ).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['a', 'b'],
      properties: { b: { additionalProperties: false, required: ['c'] } },
    });
  });
});
