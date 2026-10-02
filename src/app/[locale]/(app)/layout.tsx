/** Zona autenticada: exige sesión para todas las rutas del grupo (app). */
import type { ReactNode } from 'react';
import { requireUser } from '@/app/_server/session';

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return children;
}
