/** Configuración de idiomas: español por defecto e inglés, siempre con prefijo en la URL. */
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['es', 'en'],
  defaultLocale: 'es',
  localePrefix: 'always',
});

export type AppLocale = (typeof routing.locales)[number];
