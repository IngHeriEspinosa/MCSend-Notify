import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsWcagAA, relativeLuminance } from './color-contrast';

describe('color-contrast', () => {
  it('calcula los extremos de luminancia', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('calcula la razón máxima entre blanco y negro', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('es simétrico respecto al orden de los colores', () => {
    expect(contrastRatio('#005e7d', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#005e7d'),
      10,
    );
  });

  it('distingue texto normal de texto grande', () => {
    expect(meetsWcagAA('#008cba', '#ffffff')).toBe(false);
    expect(meetsWcagAA('#008cba', '#ffffff', { largeText: true })).toBe(true);
  });

  it('rechaza colores con formato inválido', () => {
    expect(() => relativeLuminance('blue')).toThrow(/Color inválido/);
  });
});
