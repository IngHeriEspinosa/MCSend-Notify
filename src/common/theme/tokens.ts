/**
 * Tokens de diseño de Multicómputos: fuente única para MUI, Tailwind y las plantillas de correo.
 *
 * Origen: Manual de Identidad Corporativa (desing/BrandBook), sección "06. Colores identidad":
 * Azul Pantone 308 C, Amarillo Pantone 143 C, Cielo Pantone 640 C y Gris Cool Gray 9 C.
 *
 * Reglas de accesibilidad (WCAG AA), verificadas en tokens.test.ts:
 * - El Amarillo nunca se usa como color de texto sobre fondo claro (1,99:1); solo como fondo
 *   con texto oscuro o como elemento decorativo.
 * - El Cielo solo cumple AA en texto grande sobre blanco; para texto normal se usa `skyText`.
 * - En modo oscuro el primario se aclara para mantener el contraste sobre el fondo.
 */

export const brandColors = {
  /** Azul Multicómputos, Pantone 308 C. */
  blue: '#005E7D',
  /** Amarillo Multicómputos, Pantone 143 C. */
  yellow: '#EBAD39',
  /** Cielo Multicómputos, Pantone 640 C. */
  sky: '#008CBA',
  /** Gris Multicómputos, Pantone Cool Gray 9 C. */
  gray: '#878785',
} as const;

export interface ColorSchemeTokens {
  primary: { main: string; light: string; dark: string; contrastText: string };
  secondary: { main: string; light: string; dark: string; contrastText: string };
  info: { main: string; contrastText: string };
  background: { default: string; paper: string };
  text: { primary: string; secondary: string };
  divider: string;
  /** Variante del Cielo apta para texto normal sobre el fondo del esquema. */
  skyText: string;
}

export const lightScheme: ColorSchemeTokens = {
  primary: { main: brandColors.blue, light: '#006F97', dark: '#004A63', contrastText: '#FFFFFF' },
  secondary: {
    main: brandColors.yellow,
    light: '#F0C066',
    dark: '#C98F1F',
    contrastText: '#1A1A1A',
  },
  info: { main: brandColors.sky, contrastText: '#FFFFFF' },
  background: { default: '#F5F7F9', paper: '#FFFFFF' },
  text: { primary: '#1A1A1A', secondary: '#5F5F5D' },
  divider: '#D9DCDF',
  skyText: '#006F97',
};

export const darkScheme: ColorSchemeTokens = {
  primary: { main: '#5CB8D6', light: '#7CC4DC', dark: '#3A9DBF', contrastText: '#121212' },
  secondary: {
    main: brandColors.yellow,
    light: '#F0C066',
    dark: '#C98F1F',
    contrastText: '#1A1A1A',
  },
  info: { main: '#5CB8D6', contrastText: '#121212' },
  background: { default: '#121212', paper: '#1E1E1E' },
  text: { primary: '#ECEFF1', secondary: '#B0B0AE' },
  divider: '#2E3338',
  skyText: '#7CC4DC',
};

export const typographyTokens = {
  /**
   * El manual define Gotham para titulares y Calibri para medios digitales y correo.
   * Ambas son comerciales: en web se usan Montserrat (análoga a Gotham) y Carlito
   * (métricamente compatible con Calibri), con Calibri como primera opción si está instalada.
   */
  headingFamily: 'var(--font-brand-heading), "Gotham", "Montserrat", "Segoe UI", sans-serif',
  bodyFamily: 'var(--font-brand-body), "Calibri", "Carlito", "Segoe UI", Arial, sans-serif',
  /** Pila para el HTML de correo, donde no hay fuentes web fiables. */
  emailFamily: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
} as const;

export const shapeTokens = {
  borderRadius: 10,
} as const;
