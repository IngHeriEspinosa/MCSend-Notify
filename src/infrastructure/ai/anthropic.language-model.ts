/**
 * Claude con el SDK oficial (`@anthropic-ai/sdk`).
 *
 * - Salida estructurada nativa (`output_config.format` con el JSON Schema del esquema Zod); la
 *   respuesta se valida de nuevo con Zod al recibirla.
 * - Opus 5.5 piensa siempre: no se envía `thinking`, ni `temperature`, ni `tool_choice`; la
 *   profundidad se regula con `output_config.effort` en los modelos que lo admiten.
 * - Instrucciones del sistema con `cache_control` (caché de prompts entre llamadas del tenant).
 * - `stop_reason` se comprueba antes de leer el contenido: `refusal` y `max_tokens` son errores
 *   tipados que conservan el uso consumido para registrar su coste.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  AiModelError,
  type LanguageModel,
  type StructuredRequest,
  type StructuredResponse,
} from '@/core/ai/ports';
import type { TokenUsage } from '@/core/ai/pricing';

/** Modelos que admiten `output_config.effort`. */
const EFFORT_MODELS = /^claude-(opus|sonnet|fable|mythos)-5/;

export function anthropicUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

export function mapAnthropicError(error: unknown): unknown {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AiModelError('AUTH', 'Clave de Anthropic inválida o sin permisos');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiModelError('RATE_LIMITED', 'Anthropic limitó la petición');
  }
  if (
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.UnprocessableEntityError
  ) {
    return new AiModelError(
      'CONFIG',
      `Anthropic rechazó la petición: ${error.message.slice(0, 300)}`,
    );
  }
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new AiModelError('UNAVAILABLE', 'Anthropic no está disponible');
  }
  return error;
}

export class AnthropicLanguageModel implements LanguageModel {
  constructor(
    private readonly client: Anthropic,
    readonly model: string,
  ) {}

  async generateObject<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const format = zodOutputFormat(request.schema);
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxOutputTokens,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: request.prompt }],
        output_config: {
          format: { type: 'json_schema', schema: format.schema },
          ...(EFFORT_MODELS.test(this.model) ? { effort: request.effort } : {}),
        },
      });
    } catch (error) {
      throw mapAnthropicError(error);
    }

    const usage = anthropicUsage(message.usage);
    if (message.stop_reason === 'refusal') {
      throw new AiModelError('REFUSED', 'El modelo declinó responder', usage);
    }
    if (
      message.stop_reason === 'max_tokens' ||
      message.stop_reason === 'model_context_window_exceeded'
    ) {
      throw new AiModelError('TRUNCATED', 'La respuesta superó el límite de tokens', usage);
    }
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AiModelError('INVALID_OUTPUT', 'La respuesta no es JSON', usage);
    }
    const result = request.schema.safeParse(parsed);
    if (!result.success) {
      throw new AiModelError('INVALID_OUTPUT', 'La respuesta no cumple el esquema', usage);
    }
    return { value: result.data, model: message.model, usage };
  }
}
