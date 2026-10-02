/** /t/{slug} redirige al panel de inicio del tenant. */
import { redirect } from 'next/navigation';

export default async function TenantIndexPage({ params }: PageProps<'/[locale]/t/[tenantSlug]'>) {
  const { locale, tenantSlug } = await params;
  redirect(`/${locale}/t/${tenantSlug}/dashboard`);
}
