/** Tipado estricto de next-intl: las claves de mensajes se validan en compilación. */
import type messages from './messages/es.json';
import type { routing } from './routing';

declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
