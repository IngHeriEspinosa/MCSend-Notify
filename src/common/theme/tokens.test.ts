import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsWcagAA } from '@/common/utils/color-contrast';
import { brandColors, darkScheme, lightScheme, type ColorSchemeTokens } from './tokens';

const schemes: Array<[string, ColorSchemeTokens]> = [
  ['claro', lightScheme],
  ['oscuro', darkScheme],
];

describe.each(schemes)('tokens del esquema %s (WCAG AA)', (_name, scheme) => {
  it('el texto principal y secundario cumplen AA sobre el fondo y el papel', () => {
    for (const surface of [scheme.background.default, scheme.background.paper]) {
      expect(meetsWcagAA(scheme.text.primary, surface)).toBe(true);
      expect(meetsWcagAA(scheme.text.secondary, surface)).toBe(true);
    }
  });

  it('el primario cumple AA como texto sobre el papel', () => {
    expect(meetsWcagAA(scheme.primary.main, scheme.background.paper)).toBe(true);
  });

  it('los textos de contraste cumplen AA sobre sus colores', () => {
    expect(meetsWcagAA(scheme.primary.contrastText, scheme.primary.main)).toBe(true);
    expect(meetsWcagAA(scheme.secondary.contrastText, scheme.secondary.main)).toBe(true);
  });

  it('la variante de texto del Cielo cumple AA sobre el papel', () => {
    expect(meetsWcagAA(scheme.skyText, scheme.background.paper)).toBe(true);
  });
});

describe('restricciones documentadas de la marca', () => {
  it('el Amarillo no es legible como texto sobre blanco', () => {
    expect(contrastRatio(brandColors.yellow, '#FFFFFF')).toBeLessThan(3);
  });

  it('el Cielo solo alcanza AA para texto grande sobre blanco', () => {
    expect(meetsWcagAA(brandColors.sky, '#FFFFFF')).toBe(false);
    expect(meetsWcagAA(brandColors.sky, '#FFFFFF', { largeText: true })).toBe(true);
  });
});
