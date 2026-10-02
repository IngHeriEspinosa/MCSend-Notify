import { describe, expect, it } from 'vitest';
import {
  BUTTON_TEXT_DARK,
  BUTTON_TEXT_LIGHT,
  buttonTextColor,
  DEFAULT_BRANDING,
  parseBranding,
  updateBrandingSchema,
} from './branding';

describe('branding', () => {
  it('elige el texto del botón con más contraste', () => {
    expect(buttonTextColor('#005E7D')).toBe(BUTTON_TEXT_LIGHT);
    expect(buttonTextColor('#EBAD39')).toBe(BUTTON_TEXT_DARK);
  });

  it('rechaza un color principal sin contraste AA sobre blanco', () => {
    const result = updateBrandingSchema.safeParse({
      primary: '#EBAD39',
      accent: '#005E7D',
      footerMd: '',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['primary'], message: 'LOW_CONTRAST' });
  });

  it('acepta la paleta de Multicómputos y normaliza los valores', () => {
    expect(
      updateBrandingSchema.parse({ primary: '#005e7d', accent: '#ebad39', footerMd: '  ' }),
    ).toEqual({ primary: '#005E7D', accent: '#EBAD39', footerMd: null });
  });

  it('lee de forma tolerante el JSON guardado', () => {
    expect(parseBranding(null)).toEqual(DEFAULT_BRANDING);
    expect(parseBranding({ primary: 'rojo', accent: '#ebad39', logoKey: '', extra: 1 })).toEqual({
      ...DEFAULT_BRANDING,
      accent: '#EBAD39',
    });
  });
});
