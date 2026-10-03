/**
 * Revisión de una campaña pendiente de aprobación. Es el destino del enlace del correo: exige
 * sesión y la decisión se toma con un POST (Server Action), nunca al abrir el enlace.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/app/_server/session';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ApprovalReview } from '@/components/organisms/ApprovalReview';
import { can } from '@/core/identity/permissions';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Approvals');
  return { title: t('reviewTitle') };
}

export default async function ApprovalPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/approvals/[approvalId]'>) {
  const { tenantSlug, approvalId } = await params;
  if (!z.uuid().safeParse(approvalId).success) notFound();
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'campaign:read')) notFound();
  const t = await getTranslations();
  const detail = await useCases
    .approvals()
    .get(context, approvalId)
    .catch((error: unknown) => {
      if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    });
  const preview = await useCases.campaigns().preview(context, {
    campaignId: detail.campaign.id,
    contactId: null,
    colorScheme: 'light',
    variant: 'A',
  });

  return (
    <>
      <PageHeader
        title={t('Approvals.reviewTitle')}
        subtitle={detail.approval.automationName}
        actions={
          <LinkButton href={`/t/${tenantSlug}/approvals`} variant="outlined">
            {t('Common.back')}
          </LinkButton>
        }
      />
      <ApprovalReview
        tenantSlug={tenantSlug}
        approval={{
          id: detail.approval.id,
          status: detail.approval.status,
          automationName: detail.approval.automationName,
          automationId: detail.approval.automationId,
          expiresAt: detail.approval.expiresAt,
          decidedAt: detail.approval.decidedAt,
          comment: detail.approval.comment,
        }}
        campaign={{
          id: detail.campaign.id,
          name: detail.campaign.name,
          version: detail.campaign.version,
        }}
        templateVersion={detail.templateVersion}
        subject={preview.subject}
        previewHtml={preview.html}
        recipients={detail.recipients}
        blocking={detail.blocking}
        canDecide={detail.canDecide}
        removedLinks={detail.removedLinks}
        timeZone={tenant.timezone}
      />
    </>
  );
}
