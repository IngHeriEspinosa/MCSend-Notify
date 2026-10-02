/**
 * Tema MUI con variables CSS (prefijo `mc`) y esquemas claro/oscuro conmutados por clase,
 * compartido con Tailwind a través de `globals.css`.
 */
import { createTheme } from '@mui/material/styles';
import {
  darkScheme,
  lightScheme,
  shapeTokens,
  typographyTokens,
  type ColorSchemeTokens,
} from './tokens';

function toPalette(scheme: ColorSchemeTokens) {
  return {
    primary: scheme.primary,
    secondary: scheme.secondary,
    info: scheme.info,
    background: scheme.background,
    text: scheme.text,
    divider: scheme.divider,
  };
}

const headingStyle = { fontFamily: typographyTokens.headingFamily, fontWeight: 700 } as const;

export const muiTheme = createTheme({
  cssVariables: { cssVarPrefix: 'mc', colorSchemeSelector: 'class' },
  colorSchemes: {
    light: { palette: toPalette(lightScheme) },
    dark: { palette: toPalette(darkScheme) },
  },
  shape: { borderRadius: shapeTokens.borderRadius },
  typography: {
    fontFamily: typographyTokens.bodyFamily,
    h1: headingStyle,
    h2: headingStyle,
    h3: headingStyle,
    h4: headingStyle,
    h5: headingStyle,
    h6: headingStyle,
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiLink: { defaultProps: { underline: 'hover' } },
  },
});
