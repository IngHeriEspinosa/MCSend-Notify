/** Panel de inicio del tenant: audiencia, actividad de envío de 30 días y accesos rápidos. */
import Typography from '@mui/material/Typography';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/app/_server/session';
import { Link } from '@/common/i18n/navigation';
import { CAMPAIGN_STATUS_TONE, percent } from '@/common/utils/campaigns-ui';
import { StatusChip } from '@/components/atoms/StatusChip';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { StatCard } from '@/components/molecules/StatCard';
import { ActivityChart } from '@/components/organisms/ActivityChart';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

const ACTIVITY_DAYS = 30;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Nav');
  return { title: t('dashboard') };
}

export default async function DashboardPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/dashboard'>) {
  const { locale, tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  const canSeeCampaigns = can(context.actor, 'campaign:read');
  const [stats, activity, campaigns] = await Promise.all([
    useCases.tenantStats().execute(context),
    canSeeCampaigns ? useCases.campaigns().activity(context, ACTIVITY_DAYS) : Promise.resolve([]),
    canSeeCampaigns ? useCases.campaigns().list(context) : Promise.resolve([]),
  ]);
  const t = await getTranslations();
  const base = `/t/${tenant.slug}`;
  const totals = activity.reduce(
    (sum, day) => ({
      sent: sum.sent + day.sent,
      opened: sum.opened + day.opened,
      clicked: sum.clicked + day.clicked,
    }),
    { sent: 0, opened: 0, clicked: 0 },
  );
  const numberFormat = new Intl.NumberFormat(locale);

  const cards = [
    { label: t('Dashboard.contacts'), value: stats.contacts },
    { label: t('Dashboard.activeContacts'), value: stats.activeContacts },
    { label: t('Dashboard.lists'), value: stats.lists },
    { label: t('Dashboard.segments'), value: stats.segments },
    { label: t('Dashboard.members'), value: stats.members },
  ];

  return (
    <>
      <PageHeader title={t('Dashboard.title', { tenant: tenant.name })} />
      <section
        aria-label={t('Dashboard.contacts')}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        {cards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} locale={locale} />
        ))}
      </section>

      {canSeeCampaigns ? (
        <section className="mt-10 flex flex-col gap-4" aria-labelledby="activity-title">
          <div className="flex flex-col gap-1">
            <Typography id="activity-title" variant="h6" component="h2">
              {t('Dashboard.activityTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('Dashboard.activitySummary', {
                sent: numberFormat.format(totals.sent),
                opened: numberFormat.format(percent(totals.opened, totals.sent)),
                clicked: numberFormat.format(percent(totals.clicked, totals.sent)),
              })}
            </Typography>
          </div>
          <ActivityChart data={activity} />
          {campaigns.length > 0 ? (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {campaigns.slice(0, 5).map((campaign) => (
                <li key={campaign.id} className="flex items-center gap-3 px-4 py-3">
                  <Link
                    href={`${base}/campaigns/${campaign.id}`}
                    className="mr-auto font-medium text-primary hover:underline"
                  >
                    {campaign.name}
                  </Link>
                  <StatusChip
                    label={t(`Campaigns.statuses.${campaign.status}`)}
                    tone={CAMPAIGN_STATUS_TONE[campaign.status]}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="mt-10 flex flex-col gap-3">
        <Typography variant="h6" component="h2">
          {t('Dashboard.quickActions')}
        </Typography>
        <div className="flex flex-wrap gap-3">
          {can(context.actor, 'campaign:write') ? (
            <LinkButton href={`${base}/campaigns`} variant="contained">
              {t('Dashboard.newCampaign')}
            </LinkButton>
          ) : null}
          {can(context.actor, 'contact:import') ? (
            <LinkButton href={`${base}/contacts/import`} variant="outlined">
              {t('Dashboard.importContacts')}
            </LinkButton>
          ) : null}
          {can(context.actor, 'segment:write') ? (
            <LinkButton href={`${base}/segments/new`} variant="outlined">
              {t('Dashboard.newSegment')}
            </LinkButton>
          ) : null}
          {can(context.actor, 'member:manage') ? (
            <LinkButton href={`${base}/settings/members`} variant="outlined">
              {t('Dashboard.inviteMember')}
            </LinkButton>
          ) : null}
        </div>
      </section>
    </>
  );
}
