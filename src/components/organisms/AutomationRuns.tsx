'use client';

/**
 * Control de una automatización (activar, ejecutar ahora, eliminar) e historial de ejecuciones.
 * Mientras hay una ejecución en curso, la página se refresca cada pocos segundos.
 */
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  deleteAutomationAction,
  runAutomationNowAction,
  setAutomationEnabledAction,
} from '@/app/_server/actions/automations.actions';
import { useAction, useActionErrorMessage } from '@/common/hooks/use-action';
import { Link, useRouter } from '@/common/i18n/navigation';
import { RUN_STATUS_TONE } from '@/common/utils/automations-ui';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import type { AutomationRunRecord } from '@/core/automations/automation';

const REFRESH_MS = 5000;

interface AutomationRunsProps {
  tenantSlug: string;
  automationId: string;
  enabled: boolean;
  scheduleText: string;
  runs: AutomationRunRecord[];
  canWrite: boolean;
  aiEnabled: boolean;
  timeZone: string;
}

export function AutomationRuns({
  tenantSlug,
  automationId,
  enabled,
  scheduleText,
  runs,
  canWrite,
  aiEnabled,
  timeZone,
}: AutomationRunsProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { run, pending } = useAction();
  const errorMessage = useActionErrorMessage();
  const [deleting, setDeleting] = useState(false);
  const running = runs.some((item) => item.status === 'RUNNING');
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  return (
    <div className="flex flex-col gap-6">
      <Card variant="outlined">
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <FormControlLabel
              control={
                <Switch
                  checked={enabled}
                  disabled={!canWrite || pending}
                  onChange={(event) =>
                    void run(
                      () =>
                        setAutomationEnabledAction(tenantSlug, {
                          id: automationId,
                          enabled: event.target.checked,
                        }),
                      {
                        successMessage: event.target.checked
                          ? t('Automations.enabledMessage')
                          : t('Automations.disabledMessage'),
                      },
                    )
                  }
                />
              }
              label={enabled ? t('Automations.active') : t('Automations.inactive')}
            />
            <Typography variant="body2" color="text.secondary" className="mr-auto">
              {enabled ? scheduleText : t('Automations.inactiveHint')}
            </Typography>
            {canWrite ? (
              <>
                <Button
                  variant="outlined"
                  startIcon={<PlayArrowOutlined />}
                  disabled={pending || running || !aiEnabled}
                  onClick={() =>
                    void run(() => runAutomationNowAction(tenantSlug, { id: automationId }), {
                      successMessage: t('Automations.runQueued'),
                    })
                  }
                >
                  {t('Automations.runNow')}
                </Button>
                <Button color="error" disabled={pending} onClick={() => setDeleting(true)}>
                  {t('Common.delete')}
                </Button>
              </>
            ) : null}
          </div>
          {!aiEnabled ? <Alert severity="warning">{t('Automations.aiRequired')}</Alert> : null}
        </CardContent>
      </Card>

      <section aria-labelledby="automation-runs" className="flex flex-col gap-3">
        <Typography id="automation-runs" variant="h6" component="h2">
          {t('Automations.runsTitle')}
        </Typography>
        {runs.length === 0 ? (
          <Typography color="text.secondary">{t('Automations.noRuns')}</Typography>
        ) : (
          <TableContainer className="rounded-lg border border-line">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('Automations.started')}</TableCell>
                  <TableCell>{t('Automations.trigger')}</TableCell>
                  <TableCell>{t('Campaigns.status')}</TableCell>
                  <TableCell>{t('Automations.result')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap">
                      {dateFormat.format(item.startedAt)}
                    </TableCell>
                    <TableCell>{t(`Automations.triggers.${item.trigger}`)}</TableCell>
                    <TableCell>
                      <StatusChip
                        label={t(`Automations.runStatuses.${item.status}`)}
                        tone={RUN_STATUS_TONE[item.status]}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {item.campaignId ? (
                          <Link
                            href={`/t/${tenantSlug}/campaigns/${item.campaignId}`}
                            className="text-primary hover:underline"
                          >
                            {t('Automations.viewCampaign')}
                          </Link>
                        ) : null}
                        {item.approval?.status === 'PENDING' ? (
                          <Link
                            href={`/t/${tenantSlug}/approvals/${item.approval.id}`}
                            className="text-primary hover:underline"
                          >
                            {t('Automations.reviewApproval')}
                          </Link>
                        ) : null}
                        {item.sources.length > 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            {t('Automations.sourcesUsed', { count: item.sources.length })}
                          </Typography>
                        ) : null}
                        {item.removedLinks.length > 0 ? (
                          <Typography variant="body2" color="warning.main">
                            {t('AiDraft.removedLinks', { count: item.removedLinks.length })}
                          </Typography>
                        ) : null}
                        {item.error ? (
                          <Typography variant="body2" color="error">
                            {errorMessage({
                              code: 'INVALID_STATE',
                              details: { reason: item.error },
                            })}
                          </Typography>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </section>

      <ConfirmDialog
        open={deleting}
        title={t('Automations.deleteTitle')}
        body={t('Automations.deleteBody')}
        confirmLabel={t('Common.delete')}
        pending={pending}
        onClose={() => setDeleting(false)}
        onConfirm={() =>
          void run(() => deleteAutomationAction(tenantSlug, { id: automationId }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => router.push(`/t/${tenantSlug}/automations`),
          })
        }
      />
    </div>
  );
}
