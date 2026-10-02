/** Panel de inicio del tenant: métricas de audiencia y accesos rápidos. */
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/app/_server/session';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { StatCard } from '@/components/molecules/StatCard';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Nav');
  return { title: t('dashboard') };
}

export default async function DashboardPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/dashboard'>) {
  const { locale, tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  const stats = await useCases.tenantStats().execute(context);
  const t = await getTranslations('Dashboard');
  const base = `/t/${tenant.slug}`;

  const cards = [
    { label: t('contacts'), value: stats.contacts },
    { label: t('activeContacts'), value: stats.activeContacts },
    { label: t('lists'), value: stats.lists },
    { label: t('segments'), value: stats.segments },
    { label: t('members'), value: stats.members },
  ];

  return (
    <>
      <PageHeader title={t('title', { tenant: tenant.name })} />
      <section aria-label={t('contacts')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} locale={locale} />
        ))}
      </section>

      <section className="mt-10 flex flex-col gap-3">
        <Typography variant="h6" component="h2">
          {t('quickActions')}
        </Typography>
        <div className="flex flex-wrap gap-3">
          {can(context.actor, 'contact:import') ? (
            <LinkButton href={`${base}/contacts/import`} variant="contained">
              {t('importContacts')}
            </LinkButton>
          ) : null}
          {can(context.actor, 'segment:write') ? (
            <LinkButton href={`${base}/segments/new`} variant="outlined">
              {t('newSegment')}
            </LinkButton>
          ) : null}
          {can(context.actor, 'member:manage') ? (
            <LinkButton href={`${base}/settings/members`} variant="outlined">
              {t('inviteMember')}
            </LinkButton>
          ) : null}
        </div>
        <Alert severity="info" className="mt-4">
          {t('comingSoon')}
        </Alert>
      </section>
    </>
  );
}
