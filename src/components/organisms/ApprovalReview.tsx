'use client';

/**
 * Revisión de una campaña pendiente de aprobación: vista previa aislada, datos del envío y
 * decisión. Aprobar envía la versión de la plantilla que se está viendo: si alguien la cambió
 * entretanto, la aprobación falla en lugar de enviar otra cosa.
 */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  approveCampaignAction,
  rejectCampaignAction,
} from '@/app/_server/actions/automations.actions';
import { useAction } from '@/common/hooks/use-action';
import { Link } from '@/common/i18n/navigation';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmailPreviewFrame } from '@/components/molecules/EmailPreviewFrame';
import type { ApprovalStatus } from '@/core/automations/automation';

interface ApprovalReviewProps {
  tenantSlug: string;
  approval: {
    id: string;
    status: ApprovalStatus;
    automationName: string;
    automationId: string;
    expiresAt: Date;
    decidedAt: Date | null;
    comment: string | null;
  };
  campaign: { id: string; name: string; version: number };
  templateVersion: number | null;
  subject: string;
  previewHtml: string;
  recipients: number;
  blocking: boolean;
  canDecide: boolean;
  removedLinks: string[];
  timeZone: string;
}

export function ApprovalReview({
  tenantSlug,
  approval,
  campaign,
  templateVersion,
  subject,
  previewHtml,
  recipients,
  blocking,
  canDecide,
  removedLinks,
  timeZone,
}: ApprovalReviewProps) {
  const t = useTranslations('Approvals');
  const locale = useLocale();
  const { run, pending } = useAction();
  const [comment, setComment] = useState('');
  const [confirming, setConfirming] = useState(false);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  });
  const numberFormat = new Intl.NumberFormat(locale);
  const pendingApproval = approval.status === 'PENDING';

  const approve = () => {
    if (templateVersion === null) return;
    void run(
      () =>
        approveCampaignAction(tenantSlug, {
          approvalId: approval.id,
          campaignVersion: campaign.version,
          templateVersion,
          comment,
        }),
      { successMessage: t('approved'), onSuccess: () => setConfirming(false) },
    );
  };

  const reject = () =>
    void run(() => rejectCampaignAction(tenantSlug, { approvalId: approval.id, comment }), {
      successMessage: t('rejected'),
    });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="flex flex-col gap-4">
        <Card variant="outlined">
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip
                label={t(`statuses.${approval.status}`)}
                tone={
                  pendingApproval
                    ? 'warning'
                    : approval.status === 'APPROVED'
                      ? 'success'
                      : 'default'
                }
              />
              {pendingApproval ? (
                <Typography variant="body2" color="text.secondary">
                  {t('expiresOn', { date: dateFormat.format(approval.expiresAt) })}
                </Typography>
              ) : null}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-ink-muted">{t('automation')}</dt>
              <dd>
                <Link
                  href={`/t/${tenantSlug}/automations/${approval.automationId}`}
                  className="text-primary hover:underline"
                >
                  {approval.automationName}
                </Link>
              </dd>
              <dt className="text-ink-muted">{t('campaign')}</dt>
              <dd>
                <Link
                  href={`/t/${tenantSlug}/campaigns/${campaign.id}`}
                  className="text-primary hover:underline"
                >
                  {campaign.name}
                </Link>
              </dd>
              <dt className="text-ink-muted">{t('subject')}</dt>
              <dd>{subject}</dd>
              <dt className="text-ink-muted">{t('recipients')}</dt>
              <dd>{numberFormat.format(recipients)}</dd>
            </dl>
            {removedLinks.length > 0 ? (
              <Alert severity="warning">
                {t('removedLinks', { count: removedLinks.length })}
                <ul className="mt-1 list-disc pl-5 break-all">
                  {removedLinks.slice(0, 5).map((link) => (
                    <li key={link}>{link}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {approval.comment ? (
              <Alert severity="info">{t('commentWas', { comment: approval.comment })}</Alert>
            ) : null}
          </CardContent>
        </Card>

        {pendingApproval && canDecide ? (
          <Card variant="outlined" component="section" aria-labelledby="approval-decision">
            <CardContent className="flex flex-col gap-3">
              <Typography id="approval-decision" variant="h6" component="h2">
                {t('decision')}
              </Typography>
              {blocking ? <Alert severity="error">{t('blocking')}</Alert> : null}
              <Typography variant="body2" color="text.secondary">
                {t('decisionHint')}
              </Typography>
              <TextField
                label={t('comment')}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                multiline
                minRows={2}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="contained"
                  disabled={pending || blocking || templateVersion === null}
                  onClick={() => setConfirming(true)}
                >
                  {t('approve')}
                </Button>
                <Button variant="outlined" color="error" disabled={pending} onClick={reject}>
                  {t('reject')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
        {pendingApproval && !canDecide ? <Alert severity="info">{t('notApprover')}</Alert> : null}
      </div>

      <section aria-label={t('preview')}>
        <EmailPreviewFrame html={previewHtml} device="desktop" dark={false} />
      </section>

      <ConfirmDialog
        open={confirming}
        title={t('confirmTitle')}
        body={t('confirmBody', { count: numberFormat.format(recipients) })}
        confirmLabel={t('approve')}
        pending={pending}
        onClose={() => setConfirming(false)}
        onConfirm={approve}
      />
    </div>
  );
}
