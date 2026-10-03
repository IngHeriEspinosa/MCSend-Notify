'use client';

/**
 * Informe de una campaña programada, en envío o terminada: progreso en vivo (sondeo cada 3 s
 * mientras está activa), métricas (aperturas humanas, clics, bajas, rebotes, quejas), A/B,
 * enlaces más pulsados, entregas con filtro y acciones (pausar, reanudar, cancelar, desprogramar).
 */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataGrid, type GridColDef, type GridPaginationModel } from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  campaignDeliveriesAction,
  campaignReportAction,
  cancelCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  unscheduleCampaignAction,
} from '@/app/_server/actions/campaigns.actions';
import { useAction } from '@/common/hooks/use-action';
import type { ActionResult } from '@/common/utils/action-result';
import { dataGridLocaleText } from '@/common/i18n/data-grid-locale';
import { Link, useRouter } from '@/common/i18n/navigation';
import { CAMPAIGN_STATUS_TONE, percent } from '@/common/utils/campaigns-ui';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { CampaignAiSummary } from './CampaignAiSummary';
import type { CampaignStatus } from '@/core/campaigns/campaign';
import {
  DELIVERY_STATUSES,
  type CampaignStats,
  type DeliveryStatus,
  type DeliveryView,
  type LinkStats,
} from '@/core/campaigns/delivery';

const LIVE_STATUSES: readonly CampaignStatus[] = ['SCHEDULED', 'DISPATCHING', 'SENDING'];
const POLL_MS = 3000;

interface CampaignReportProps {
  tenantSlug: string;
  campaign: {
    id: string;
    status: CampaignStatus;
    error: string | null;
    scheduledAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    recipientCount: number;
    subjectB: string | null;
  };
  initialStats: CampaignStats;
  initialLinks: LinkStats[];
  canSend: boolean;
  timeZone: string;
  /** IA disponible: muestra el resumen de resultados. */
  aiEnabled?: boolean;
  /** Revisión de la aprobación pendiente (campañas de automatizaciones). */
  approvalHref?: string | null;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <Card variant="outlined" className="h-full">
      <CardContent className="flex flex-col gap-1">
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" component="p">
          {value}
        </Typography>
        {hint ? (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CampaignReport({
  tenantSlug,
  campaign,
  initialStats,
  initialLinks,
  canSend,
  timeZone,
  aiEnabled = false,
  approvalHref = null,
}: CampaignReportProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { run, pending } = useAction();
  const [status, setStatus] = useState(campaign.status);
  const [error, setError] = useState(campaign.error);
  const [stats, setStats] = useState(initialStats);
  const [links, setLinks] = useState(initialLinks);
  const [cancelling, setCancelling] = useState(false);
  const [filter, setFilter] = useState<DeliveryStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [deliveries, setDeliveries] = useState<{ items: DeliveryView[]; total: number }>({
    items: [],
    total: 0,
  });
  const [loadingRows, setLoadingRows] = useState(true);
  const numberFormat = new Intl.NumberFormat(locale);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });

  useEffect(() => {
    if (!LIVE_STATUSES.includes(status)) return;
    const timer = setInterval(async () => {
      const result = await campaignReportAction(tenantSlug, { campaignId: campaign.id });
      if (!result.ok) return;
      setStats(result.data.stats);
      setLinks(result.data.links);
      setError(result.data.error);
      if (result.data.status !== status) {
        setStatus(result.data.status);
        router.refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [campaign.id, router, status, tenantSlug]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingRows(true);
      const result = await campaignDeliveriesAction(tenantSlug, {
        campaignId: campaign.id,
        ...(filter === 'ALL' ? {} : { status: filter }),
        ...(search.trim() ? { search: search.trim() } : {}),
        page: pagination.page,
        pageSize: pagination.pageSize,
      });
      if (cancelled) return;
      setLoadingRows(false);
      if (result.ok) setDeliveries({ items: result.data.items, total: result.data.total });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [campaign.id, filter, pagination, search, tenantSlug, stats.total]);

  const by = stats.byStatus;
  const sent = by.SENT + by.DELIVERED + by.BOUNCED + by.COMPLAINED;
  const processed = stats.total - by.QUEUED - by.SENDING;
  const progress = percent(processed, stats.total);
  const formatPct = (part: number, total: number) =>
    `${numberFormat.format(percent(part, total))} %`;

  // Las Server Actions refrescan la página; la página monta el informe con `key` = estado.
  const action = (fn: () => Promise<ActionResult<void>>, message: string) =>
    void run(fn, { successMessage: message });

  const columns: GridColDef<DeliveryView>[] = [
    { field: 'email', headerName: t('CampaignReport.columns.email'), flex: 1, minWidth: 200 },
    {
      field: 'status',
      headerName: t('CampaignReport.columns.status'),
      width: 150,
      renderCell: ({ row }) => (
        <StatusChip label={t(`CampaignReport.deliveryStatuses.${row.status}`)} />
      ),
    },
    { field: 'variant', headerName: 'A/B', width: 70 },
    {
      field: 'sentAt',
      headerName: t('CampaignReport.columns.sentAt'),
      width: 170,
      valueFormatter: (value: Date | null) => (value ? dateFormat.format(new Date(value)) : '—'),
    },
    {
      field: 'firstOpenedAt',
      headerName: t('CampaignReport.columns.opened'),
      width: 120,
      valueGetter: (_value, row) =>
        row.firstOpenedAt
          ? row.machineOpenOnly
            ? t('CampaignReport.machine')
            : t('Common.yes')
          : '—',
    },
    {
      field: 'firstClickedAt',
      headerName: t('CampaignReport.columns.clicked'),
      width: 110,
      valueGetter: (_value, row) => (row.firstClickedAt ? t('Common.yes') : '—'),
    },
    { field: 'lastError', headerName: t('CampaignReport.columns.error'), flex: 1, minWidth: 160 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip label={t(`Campaigns.statuses.${status}`)} tone={CAMPAIGN_STATUS_TONE[status]} />
        <Typography variant="body2" color="text.secondary" className="mr-auto">
          {status === 'SCHEDULED' && campaign.scheduledAt
            ? t('CampaignReport.scheduledFor', { date: dateFormat.format(campaign.scheduledAt) })
            : campaign.finishedAt
              ? t('CampaignReport.finishedAt', { date: dateFormat.format(campaign.finishedAt) })
              : campaign.startedAt
                ? t('CampaignReport.startedAt', { date: dateFormat.format(campaign.startedAt) })
                : null}
        </Typography>
        {canSend ? (
          <div className="flex flex-wrap gap-2">
            {status === 'SCHEDULED' ? (
              <Button
                variant="outlined"
                disabled={pending}
                onClick={() =>
                  action(
                    () => unscheduleCampaignAction(tenantSlug, { campaignId: campaign.id }),
                    t('CampaignReport.unscheduled'),
                  )
                }
              >
                {t('CampaignReport.unschedule')}
              </Button>
            ) : null}
            {status === 'DISPATCHING' || status === 'SENDING' ? (
              <Button
                variant="outlined"
                disabled={pending}
                onClick={() =>
                  action(
                    () => pauseCampaignAction(tenantSlug, { campaignId: campaign.id }),
                    t('CampaignReport.paused'),
                  )
                }
              >
                {t('CampaignReport.pause')}
              </Button>
            ) : null}
            {status === 'PAUSED' ? (
              <Button
                variant="contained"
                disabled={pending}
                onClick={() =>
                  action(
                    () => resumeCampaignAction(tenantSlug, { campaignId: campaign.id }),
                    t('CampaignReport.resumed'),
                  )
                }
              >
                {t('CampaignReport.resume')}
              </Button>
            ) : null}
            {['SCHEDULED', 'DISPATCHING', 'SENDING', 'PAUSED'].includes(status) ? (
              <Button color="error" disabled={pending} onClick={() => setCancelling(true)}>
                {t('CampaignReport.cancel')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert severity={status === 'FAILED' ? 'error' : 'warning'}>
          {t(
            `CampaignReport.errors.${error === 'PROVIDER_ERROR' || error === 'BLOCKING_ISSUES' ? error : 'GENERIC'}`,
          )}
        </Alert>
      ) : null}

      {status === 'PENDING_APPROVAL' ? (
        <Alert
          severity="warning"
          action={
            approvalHref ? (
              <Button component={Link} href={approvalHref} color="inherit">
                {t('CampaignReport.reviewApproval')}
              </Button>
            ) : undefined
          }
        >
          {t('CampaignReport.pendingApproval')}
        </Alert>
      ) : null}

      {aiEnabled && ['SENDING', 'PAUSED', 'SENT'].includes(status) ? (
        <CampaignAiSummary tenantSlug={tenantSlug} campaignId={campaign.id} />
      ) : null}

      {status !== 'SCHEDULED' && status !== 'PENDING_APPROVAL' ? (
        <section aria-labelledby="campaign-progress" className="flex flex-col gap-2">
          <Typography id="campaign-progress" variant="subtitle1" component="h2">
            {t('CampaignReport.progress', {
              processed: numberFormat.format(processed),
              total: numberFormat.format(stats.total),
            })}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress}
            aria-label={t('CampaignReport.progressLabel')}
            aria-valuetext={`${progress} %`}
          />
        </section>
      ) : null}

      <section
        aria-label={t('CampaignReport.metrics')}
        className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5"
      >
        <Kpi label={t('CampaignReport.kpis.recipients')} value={numberFormat.format(stats.total)} />
        <Kpi
          label={t('CampaignReport.kpis.sent')}
          value={numberFormat.format(sent)}
          hint={
            by.DELIVERED > 0 ? t('CampaignReport.delivered', { count: by.DELIVERED }) : undefined
          }
        />
        <Kpi
          label={t('CampaignReport.kpis.opened')}
          value={formatPct(stats.opened, sent)}
          hint={t('CampaignReport.openedHint', {
            count: stats.opened,
            machine: stats.machineOpens,
          })}
        />
        <Kpi
          label={t('CampaignReport.kpis.clicked')}
          value={formatPct(stats.clicked, sent)}
          hint={t('CampaignReport.uniqueCount', { count: stats.clicked })}
        />
        <Kpi
          label={t('CampaignReport.kpis.downloads')}
          value={numberFormat.format(stats.downloads)}
        />
        <Kpi
          label={t('CampaignReport.kpis.unsubscribed')}
          value={numberFormat.format(stats.unsubscribed)}
        />
        <Kpi label={t('CampaignReport.kpis.bounced')} value={numberFormat.format(by.BOUNCED)} />
        <Kpi
          label={t('CampaignReport.kpis.complained')}
          value={numberFormat.format(by.COMPLAINED)}
        />
        <Kpi label={t('CampaignReport.kpis.failed')} value={numberFormat.format(by.FAILED)} />
        <Kpi
          label={t('CampaignReport.kpis.suppressed')}
          value={numberFormat.format(by.SUPPRESSED + by.CANCELLED)}
        />
      </section>

      {campaign.subjectB ? (
        <section className="flex flex-col gap-2">
          <Typography variant="h6" component="h2">
            {t('CampaignReport.abTitle')}
          </Typography>
          <TableContainer className="rounded-lg border border-line">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('CampaignReport.variant')}</TableCell>
                  <TableCell align="right">{t('CampaignReport.kpis.sent')}</TableCell>
                  <TableCell align="right">{t('CampaignReport.kpis.opened')}</TableCell>
                  <TableCell align="right">{t('CampaignReport.kpis.clicked')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(['A', 'B'] as const).map((key) => (
                  <TableRow key={key}>
                    <TableCell>{key}</TableCell>
                    <TableCell align="right">
                      {numberFormat.format(stats.variants[key].sent)}
                    </TableCell>
                    <TableCell align="right">
                      {formatPct(stats.variants[key].opened, stats.variants[key].sent)}
                    </TableCell>
                    <TableCell align="right">
                      {formatPct(stats.variants[key].clicked, stats.variants[key].sent)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </section>
      ) : null}

      {links.length > 0 ? (
        <section className="flex flex-col gap-2">
          <Typography variant="h6" component="h2">
            {t('CampaignReport.linksTitle')}
          </Typography>
          <TableContainer className="rounded-lg border border-line">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>URL</TableCell>
                  <TableCell align="right">{t('CampaignReport.clicks')}</TableCell>
                  <TableCell align="right">{t('CampaignReport.uniqueClicks')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {links.map((link) => (
                  <TableRow key={link.linkId}>
                    <TableCell className="max-w-md truncate">{link.url}</TableCell>
                    <TableCell align="right">{numberFormat.format(link.clicks)}</TableCell>
                    <TableCell align="right">{numberFormat.format(link.uniqueClicks)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <Typography variant="h6" component="h2">
          {t('CampaignReport.deliveriesTitle')}
        </Typography>
        <div className="flex flex-col gap-3 sm:flex-row">
          <TextField
            size="small"
            label={t('Common.search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPagination((current) => ({ ...current, page: 0 }));
            }}
            className="sm:w-72"
          />
          <TextField
            select
            size="small"
            label={t('CampaignReport.columns.status')}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as DeliveryStatus | 'ALL');
              setPagination((current) => ({ ...current, page: 0 }));
            }}
            className="sm:w-56"
          >
            <MenuItem value="ALL">{t('Common.all')}</MenuItem>
            {DELIVERY_STATUSES.map((item) => (
              <MenuItem key={item} value={item}>
                {t(`CampaignReport.deliveryStatuses.${item}`)}
              </MenuItem>
            ))}
          </TextField>
        </div>
        <div className="w-full overflow-x-auto">
          <DataGrid
            rows={deliveries.items}
            columns={columns}
            rowCount={deliveries.total}
            loading={loadingRows}
            paginationMode="server"
            paginationModel={pagination}
            onPaginationModelChange={setPagination}
            pageSizeOptions={[25, 50, 100]}
            disableRowSelectionOnClick
            disableColumnMenu
            autoHeight
            localeText={{
              ...dataGridLocaleText(locale),
              noRowsLabel: t('CampaignReport.noDeliveries'),
            }}
          />
        </div>
      </section>

      <ConfirmDialog
        open={cancelling}
        title={t('CampaignReport.cancelTitle')}
        body={t('CampaignReport.cancelBody')}
        confirmLabel={t('CampaignReport.cancel')}
        pending={pending}
        onClose={() => setCancelling(false)}
        onConfirm={() => {
          setCancelling(false);
          action(
            () => cancelCampaignAction(tenantSlug, { campaignId: campaign.id }),
            t('CampaignReport.cancelled'),
          );
        }}
      />
    </div>
  );
}
