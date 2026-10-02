'use client';

/** Listado de campañas con su estado, alta (nombre y plantilla), duplicado y borrado. */
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  createCampaignAction,
  deleteCampaignAction,
  duplicateCampaignAction,
} from '@/app/_server/actions/campaigns.actions';
import { useAction } from '@/common/hooks/use-action';
import { Link, useRouter } from '@/common/i18n/navigation';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import { CAMPAIGN_STATUS_TONE } from '@/common/utils/campaigns-ui';
import type { CampaignSummary } from '@/core/campaigns/campaign';

interface CampaignsTableProps {
  tenantSlug: string;
  campaigns: CampaignSummary[];
  templates: Array<{ id: string; name: string }>;
  canWrite: boolean;
  timeZone: string;
}

export function CampaignsTable({
  tenantSlug,
  campaigns,
  templates,
  canWrite,
  timeZone,
}: CampaignsTableProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CampaignSummary | null>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
  const numberFormat = new Intl.NumberFormat(locale);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        createCampaignAction(tenantSlug, {
          name: String(form.get('name') ?? ''),
          templateId: String(form.get('templateId') ?? ''),
        }),
      { onSuccess: ({ id }) => router.push(`/t/${tenantSlug}/campaigns/${id}`) },
    );
  };

  const when = (campaign: CampaignSummary) => {
    const date = campaign.finishedAt ?? campaign.startedAt ?? campaign.scheduledAt;
    return date ? dateFormat.format(date) : '—';
  };

  return (
    <>
      {canWrite ? (
        <div className="mb-4 flex justify-end">
          <Button
            variant="contained"
            disabled={templates.length === 0}
            onClick={() => setCreating(true)}
          >
            {t('Campaigns.new')}
          </Button>
        </div>
      ) : null}

      {campaigns.length === 0 ? (
        <EmptyState
          message={templates.length === 0 ? t('Campaigns.needsTemplate') : t('Campaigns.empty')}
        />
      ) : (
        <TableContainer className="rounded-lg border border-line">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('Common.name')}</TableCell>
                <TableCell>{t('Campaigns.status')}</TableCell>
                <TableCell align="right">{t('Campaigns.recipients')}</TableCell>
                <TableCell>{t('Campaigns.date')}</TableCell>
                <TableCell align="right">{t('Common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {campaigns.map((campaign) => (
                <TableRow key={campaign.id} hover>
                  <TableCell>
                    <Link
                      href={`/t/${tenantSlug}/campaigns/${campaign.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {campaign.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      label={t(`Campaigns.statuses.${campaign.status}`)}
                      tone={CAMPAIGN_STATUS_TONE[campaign.status]}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {numberFormat.format(campaign.recipientCount)}
                  </TableCell>
                  <TableCell>{when(campaign)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">
                    {canWrite ? (
                      <>
                        <IconButton
                          aria-label={`${t('Campaigns.duplicate')}: ${campaign.name}`}
                          disabled={pending}
                          onClick={() =>
                            void run(
                              () =>
                                duplicateCampaignAction(tenantSlug, {
                                  campaignId: campaign.id,
                                  name: t('Campaigns.copyName', { name: campaign.name }).slice(
                                    0,
                                    120,
                                  ),
                                }),
                              {
                                onSuccess: ({ id }) =>
                                  router.push(`/t/${tenantSlug}/campaigns/${id}`),
                              },
                            )
                          }
                        >
                          <ContentCopyOutlined />
                        </IconButton>
                        {['DRAFT', 'CANCELLED', 'FAILED'].includes(campaign.status) ? (
                          <IconButton
                            aria-label={`${t('Common.delete')}: ${campaign.name}`}
                            onClick={() => setDeleting(campaign)}
                          >
                            <DeleteOutlined />
                          </IconButton>
                        ) : null}
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="sm">
        <form onSubmit={create} noValidate>
          <DialogTitle>{t('Campaigns.new')}</DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            <TextField
              name="name"
              label={t('Common.name')}
              required
              autoFocus
              fullWidth
              margin="dense"
              error={Boolean(fieldErrors.name)}
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            <TextField
              select
              name="templateId"
              label={t('Campaigns.template')}
              defaultValue={templates[0]?.id ?? ''}
              fullWidth
            >
              {templates.map((template) => (
                <MenuItem key={template.id} value={template.id}>
                  {template.name}
                </MenuItem>
              ))}
            </TextField>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreating(false)}>{t('Common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {t('Common.create')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={t('Campaigns.deleteTitle')}
        body={t('Common.deleteConfirmBody')}
        confirmLabel={t('Common.delete')}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          void run(() => deleteCampaignAction(tenantSlug, { campaignId: deleting.id }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => setDeleting(null),
          })
        }
      />
    </>
  );
}
