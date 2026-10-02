/** Campaña: asistente mientras es un borrador; informe en vivo una vez programada o enviada. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/app/_server/session';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { CampaignEditor } from '@/components/organisms/CampaignEditor';
import { CampaignReport } from '@/components/organisms/CampaignReport';
import { SEND_CONFIRMATION_THRESHOLD } from '@/core/campaigns/campaign';
import { isDnsHealthy } from '@/core/providers/provider-config';
import { can } from '@/core/identity/permissions';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Campaigns');
  return { title: t('detailTitle') };
}

export default async function CampaignPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/campaigns/[campaignId]'>) {
  const { locale, tenantSlug, campaignId } = await params;
  if (!z.uuid().safeParse(campaignId).success) notFound();
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'campaign:read')) notFound();
  const t = await getTranslations();
  const campaign = await useCases
    .campaigns()
    .get(context, campaignId)
    .catch((error: unknown) => {
      if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    });
  const header = (
    <PageHeader
      title={campaign.name}
      actions={
        <LinkButton href={`/t/${tenantSlug}/campaigns`} variant="outlined">
          {t('Common.back')}
        </LinkButton>
      }
    />
  );

  if (campaign.status !== 'DRAFT') {
    const report = await useCases.campaigns().report(context, campaignId);
    return (
      <>
        {header}
        <CampaignReport
          key={campaign.status}
          tenantSlug={tenantSlug}
          campaign={{
            id: campaign.id,
            status: campaign.status,
            error: campaign.error,
            scheduledAt: campaign.scheduledAt,
            startedAt: campaign.startedAt,
            finishedAt: campaign.finishedAt,
            recipientCount: campaign.recipientCount,
            subjectB: campaign.subjectB,
          }}
          initialStats={report.stats}
          initialLinks={report.links}
          canSend={can(context.actor, 'campaign:send')}
          timeZone={tenant.timezone}
        />
      </>
    );
  }

  const [templates, lists, segments, topics, senders, contacts] = await Promise.all([
    useCases.templates().list(context),
    useCases.lists().list(context),
    useCases.segments().list(context),
    useCases.topics().list(context),
    useCases.senders().list(context),
    useCases.listContacts().execute(context, {
      sortField: 'createdAt',
      sortDirection: 'desc',
      page: 0,
      pageSize: 20,
      status: 'ACTIVE',
    }),
  ]);

  return (
    <>
      {header}
      <CampaignEditor
        tenantSlug={tenantSlug}
        campaign={{
          id: campaign.id,
          name: campaign.name,
          version: campaign.version,
          templateId: campaign.templateId,
          audience: campaign.audience,
          topicId: campaign.topicId,
          senderIdentityId: campaign.senderIdentityId,
          subjectB: campaign.subjectB,
          trackOpens: campaign.trackOpens,
          trackClicks: campaign.trackClicks,
          throttlePerHour: campaign.throttlePerHour,
        }}
        templates={templates.map((template) => ({ id: template.id, label: template.name }))}
        lists={lists.map((list) => ({ id: list.id, label: `${list.name} (${list.memberCount})` }))}
        segments={segments.map((segment) => ({ id: segment.id, label: segment.name }))}
        topics={topics.map((topic) => ({
          id: topic.id,
          label: locale === 'en' ? topic.name.en : topic.name.es,
        }))}
        senders={senders.map((sender) => ({
          id: sender.id,
          label: `${sender.fromName} <${sender.fromEmail}>`,
          dnsOk: isDnsHealthy(sender.dnsCheck),
        }))}
        contacts={contacts.items.map((contact) => ({
          id: contact.id,
          label:
            [contact.firstName, contact.lastName].filter(Boolean).join(' ') + ` <${contact.email}>`,
        }))}
        confirmationThreshold={SEND_CONFIRMATION_THRESHOLD}
        canSend={can(context.actor, 'campaign:send')}
      />
    </>
  );
}
