/**
 * Layout raíz de paso: el documento HTML se renderiza en `[locale]/layout.tsx`
 * para poder fijar el atributo `lang` según el idioma de la ruta.
 */
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
