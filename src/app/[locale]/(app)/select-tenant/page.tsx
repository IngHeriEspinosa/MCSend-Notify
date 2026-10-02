/** Selector de aplicación (tenant). Con una sola aplicación, entra directamente. */
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { logout } from '@/app/_server/auth-actions';
import { requireUser } from '@/app/_server/session';
import { StatusChip } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import { LinkButton, LinkCardArea } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { PublicHeader } from '@/components/organisms/PublicHeader';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('SelectTenant');
  return { title: t('title') };
}

export default async function SelectTenantPage({ params }: PageProps<'/[locale]/select-tenant'>) {
  const { locale } = await params;
  const user = await requireUser();
  const tenants = await useCases.listUserTenants().execute(user);
  const t = await getTranslations();

  if (tenants.length === 1 && tenants[0] && user.platformRole !== 'SUPER_ADMIN') {
    redirect(`/${locale}/t/${tenants[0].tenant.slug}/dashboard`);
  }

  return (
    <>
      <PublicHeader />
      <main id="main-content" className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-10 sm:px-6">
        <PageHeader
          title={t('SelectTenant.title')}
          subtitle={t('SelectTenant.subtitle')}
          actions={
            <>
              {user.platformRole === 'SUPER_ADMIN' ? (
                <LinkButton href="/admin/tenants" variant="outlined">
                  {t('Shell.platformAdmin')}
                </LinkButton>
              ) : null}
              <form action={logout}>
                <Button type="submit">{t('Auth.signOut')}</Button>
              </form>
            </>
          }
        />
        {tenants.length === 0 ? (
          <EmptyState message={t('SelectTenant.empty')} />
        ) : (
          <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {tenants.map(({ tenant, role }) => (
              <li key={tenant.id}>
                <Card variant="outlined" className="h-full">
                  <LinkCardArea href={`/t/${tenant.slug}/dashboard`} className="h-full">
                    <CardContent className="flex flex-col gap-2">
                      <Typography variant="h6" component="h2">
                        {tenant.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        /{tenant.slug}
                      </Typography>
                      <div>
                        <StatusChip label={t(`Roles.${role}`)} tone="primary" />
                      </div>
                    </CardContent>
                  </LinkCardArea>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
