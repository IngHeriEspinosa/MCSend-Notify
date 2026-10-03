/** Crea el adaptador de modelo según el proveedor configurado por el tenant (patrón Factory). */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_OPENAI_BASE_URL } from '@/core/ai/ai';
import type { AiConnection, LanguageModel, LanguageModelFactory } from '@/core/ai/ports';
import { AnthropicLanguageModel } from './anthropic.language-model';
import { OpenAiCompatibleLanguageModel } from './openai-compatible.language-model';

export class DefaultLanguageModelFactory implements LanguageModelFactory {
  constructor(private readonly options: { allowPrivateHosts: boolean }) {}

  create(connection: AiConnection): LanguageModel {
    switch (connection.kind) {
      case 'ANTHROPIC':
        return new AnthropicLanguageModel(
          new Anthropic({ apiKey: connection.apiKey, maxRetries: 2, timeout: 120_000 }),
          connection.model,
        );
      case 'OPENAI':
        return new OpenAiCompatibleLanguageModel({
          baseUrl: connection.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
          apiKey: connection.apiKey,
          model: connection.model,
          flavor: 'openai',
          allowPrivate: false,
        });
      case 'OPENAI_COMPATIBLE':
        return new OpenAiCompatibleLanguageModel({
          baseUrl: connection.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
          apiKey: connection.apiKey,
          model: connection.model,
          flavor: 'compatible',
          allowPrivate: this.options.allowPrivateHosts,
        });
    }
  }
}
