/**
 * Coste de una llamada en millonésimas de dólar (micro-USD).
 *
 * Los precios de Claude son los públicos por millón de tokens (MTok); como 1 USD/MTok equivale a
 * 1 micro-USD por token, el coste es `tokens × precio`. Las escrituras en caché cuestan 1,25× la
 * entrada y las lecturas, la tarifa reducida de cada modelo. Para modelos sin tarifa conocida
 * (OpenAI-compatible) se usan los precios que configure el tenant o, si no hay, coste 0.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** USD por millón de tokens (precios publicados por Anthropic). */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export interface CustomPrices {
  inputPricePerMTok: number | null;
  outputPricePerMTok: number | null;
}

/** Tarifa del modelo; admite ids con fecha (`claude-haiku-4-5-20251001`). */
export function priceFor(model: string): ModelPrice | undefined {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  const alias = Object.keys(MODEL_PRICES).find((key) => model.startsWith(`${key}-`));
  return alias ? MODEL_PRICES[alias] : undefined;
}

export function costMicros(model: string, usage: TokenUsage, custom?: CustomPrices): number {
  const known = priceFor(model);
  const price: ModelPrice = known ?? {
    input: custom?.inputPricePerMTok ?? 0,
    output: custom?.outputPricePerMTok ?? 0,
    cacheRead: custom?.inputPricePerMTok ?? 0,
    cacheWrite: custom?.inputPricePerMTok ?? 0,
  };
  return Math.round(
    usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite,
  );
}
