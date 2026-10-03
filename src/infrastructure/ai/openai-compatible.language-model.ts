/**
 * Modelos con API compatible con OpenAI (OpenAI, Ollama, vLLM, LM Studio...) por HTTP, sin SDK.
 *
 * - `POST {baseUrl}/chat/completions` con `response_format: json_schema` estricto generado desde
 *   el esquema Zod; la respuesta se valida de nuevo con Zod.
 * - La URL la configura el tenant: va por `safeFetch` (sin IP privadas salvo en desarrollo, sin
 *   credenciales hacia otros orígenes en redirecciones).
 */
import { z } from 'zod';
import {
  AiModelError,
  type LanguageModel,
  type StructuredRequest,
  type StructuredResponse,
} from '@/core/ai/ports';
import type { TokenUsage } from '@/core/ai/pricing';
import { safeFetch, SafeFetchError } from '../security/safe-fetch';

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().default(0),
      completion_tokens: z.number().default(0),
      prompt_tokens_details: z.object({ cached_tokens: z.number().default(0) }).nullish(),
    })
    .nullish(),
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** JSON Schema estricto: objetos cerrados y todas sus propiedades obligatorias. */
export function strictJsonSchema(schema: z.ZodType): JsonValue {
  const visit = (node: JsonValue): JsonValue => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== 'object') return node;
    const result: { [key: string]: JsonValue } = {};
    for (const [key, value] of Object.entries(node)) {
      if (key !== '$schema') result[key] = visit(value);
    }
    if (result.type === 'object') {
      result.additionalProperties = false;
      const properties = result.properties;
      if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
        result.required = Object.keys(properties);
      }
    }
    return result;
  };
  return visit(z.toJSONSchema(schema) as JsonValue);
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  /** La API oficial de OpenAI usa `max_completion_tokens`; las compatibles, `max_tokens`. */
  flavor: 'openai' | 'compatible';
  allowPrivate: boolean;
  fetcher?: typeof safeFetch;
}

export class OpenAiCompatibleLanguageModel implements LanguageModel {
  readonly model: string;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.model = options.model;
  }

  async generateObject<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const tokens =
      this.options.flavor === 'openai'
        ? { max_completion_tokens: request.maxOutputTokens }
        : { max_tokens: request.maxOutputTokens };
    const body = JSON.stringify({
      model: this.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.schemaName,
          strict: true,
          schema: strictJsonSchema(request.schema),
        },
      },
      ...tokens,
    });
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    let status: number;
    let payload: string;
    try {
      const response = await (this.options.fetcher ?? safeFetch)(url, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        timeoutMs: 120_000,
        maxBytes: 5 * 1024 * 1024,
        ports: 'any',
        allowPrivate: this.options.allowPrivate,
      });
      status = response.status;
      payload = response.body.toString('utf8');
    } catch (error) {
      if (error instanceof SafeFetchError) {
        throw new AiModelError(
          error.code === 'BLOCKED' || error.code === 'UNSUPPORTED' ? 'CONFIG' : 'UNAVAILABLE',
          `No se pudo contactar con el modelo: ${error.message}`,
        );
      }
      throw error;
    }

    if (status === 401 || status === 403) throw new AiModelError('AUTH', 'Clave rechazada');
    if (status === 429) throw new AiModelError('RATE_LIMITED', 'El proveedor limitó la petición');
    if (status >= 500) throw new AiModelError('UNAVAILABLE', `El proveedor respondió ${status}`);
    if (status >= 400) {
      throw new AiModelError('CONFIG', `El proveedor rechazó la petición (${status})`);
    }

    let completion: z.infer<typeof completionSchema>;
    try {
      completion = completionSchema.parse(JSON.parse(payload));
    } catch {
      throw new AiModelError('INVALID_OUTPUT', 'Respuesta del proveedor no reconocida');
    }
    const cached = completion.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const usage: TokenUsage = {
      inputTokens: Math.max(0, (completion.usage?.prompt_tokens ?? 0) - cached),
      outputTokens: completion.usage?.completion_tokens ?? 0,
      cacheReadTokens: cached,
      cacheWriteTokens: 0,
    };
    const [choice] = completion.choices;
    if (choice?.message.refusal)
      throw new AiModelError('REFUSED', 'El modelo declinó responder', usage);
    if (choice?.finish_reason === 'length') {
      throw new AiModelError('TRUNCATED', 'La respuesta superó el límite de tokens', usage);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(choice?.message.content ?? '');
    } catch {
      throw new AiModelError('INVALID_OUTPUT', 'La respuesta no es JSON', usage);
    }
    const result = request.schema.safeParse(parsed);
    if (!result.success) {
      throw new AiModelError('INVALID_OUTPUT', 'La respuesta no cumple el esquema', usage);
    }
    return { value: result.data, model: completion.model ?? this.model, usage };
  }
}
