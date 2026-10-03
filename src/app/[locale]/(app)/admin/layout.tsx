/** Panel de plataforma (solo SUPER_ADMIN): aplicaciones, colas y uso de IA. */
import { requirePlatformAdmin } from '@/app/_server/session';
import { AdminNav } from '@/components/molecules/AdminNav';
import { PublicHeader } from '@/components/organisms/PublicHeader';

export default async function AdminLayout({ children }: LayoutProps<'/[locale]/admin'>) {
  await requirePlatformAdmin();
  return (
    <>
      <PublicHeader />
      <main id="main-content" className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
        <AdminNav />
        {children}
      </main>
    </>
  );
}
