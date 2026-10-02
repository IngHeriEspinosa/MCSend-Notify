/** Layout de las páginas de acceso: cabecera pública y tarjeta centrada. */
import type { ReactNode } from 'react';
import { PublicHeader } from '@/components/organisms/PublicHeader';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main
        id="main-content"
        className="flex min-h-[calc(100vh-72px)] items-start justify-center px-4 py-12 sm:items-center"
      >
        <div className="w-full max-w-md">{children}</div>
      </main>
    </>
  );
}
