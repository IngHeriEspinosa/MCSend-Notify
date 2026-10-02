/**
 * Cálculo de contraste según WCAG 2.x. Se usa para validar los tokens de marca y,
 * en fases posteriores, los colores que cada tenant configura en su branding.
 */

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;

function channelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa de un color `#rrggbb`. */
export function relativeLuminance(hexColor: string): number {
  const match = HEX_COLOR.exec(hexColor);
  if (!match?.[1]) {
    throw new Error(`Color inválido: "${hexColor}". Se espera el formato #rrggbb.`);
  }
  const hex = match[1];
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    channelToLinear(Number.parseInt(hex.slice(offset, offset + 2), 16)),
  ) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Razón de contraste entre dos colores (de 1 a 21). */
export function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Indica si el par cumple WCAG AA para texto normal (o grande, si se indica). */
export function meetsWcagAA(
  foreground: string,
  background: string,
  options: { largeText?: boolean } = {},
): boolean {
  const minimum = options.largeText ? WCAG_AA_LARGE_TEXT : WCAG_AA_NORMAL_TEXT;
  return contrastRatio(foreground, background) >= minimum;
}
