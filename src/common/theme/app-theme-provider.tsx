'use client';

/**
 * Proveedor de tema de la app: caché de Emotion para el App Router (estilos en `@layer mui`)
 * y tema MUI con esquemas claro/oscuro. El tema se crea en un módulo cliente porque
 * contiene funciones que no se pueden serializar desde un Server Component.
 */
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { muiTheme } from './mui-theme';

interface AppThemeProviderProps {
  children: ReactNode;
  nonce?: string | undefined;
}

export function AppThemeProvider({ children, nonce }: AppThemeProviderProps) {
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true, ...(nonce ? { nonce } : {}) }}>
      <ThemeProvider theme={muiTheme} defaultMode="system">
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
