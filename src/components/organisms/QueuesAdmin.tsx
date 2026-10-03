'use client';

/**
 * Panel de colas: contadores por cola y, al elegir una, sus trabajos fallidos (agotaron los
 * reintentos) con las acciones de reintentar o descartar.
 */
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  listFailedJobsAction,
  removeJobAction,
  retryJobAction,
} from '@/app/_server/actions/admin.actions';
import { useAction } from '@/common/hooks/use-action';
import { useRouter } from '@/common/i18n/navigation';
import { StatusChip } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import type { FailedJobView, QueueCounts } from '@/core/platform/platform-admin';

const COUNTERS = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;

export function QueuesAdmin({ queues }: { queues: QueueCounts[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { run, pending } = useAction();
  const [selected, setSelected] = useState<{ queue: string; jobs: FailedJobView[] } | null>(null);
  // Hora UTC: el panel es de plataforma (tenants con zonas distintas) y evita desajustes de hidratación.
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'UTC',
  });

  const load = (queue: string) =>
    void run(() => listFailedJobsAction({ queue }), {
      onSuccess: (jobs) => setSelected({ queue, jobs }),
    });

  const act = (action: typeof retryJobAction, queue: string, jobId: string, message: string) =>
    void run(() => action({ queue, jobId }), {
      successMessage: message,
      onSuccess: () => {
        load(queue);
        router.refresh();
      },
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button onClick={() => router.refresh()}>{t('Admin.refresh')}</Button>
      </div>
      <TableContainer className="rounded-lg border border-line">
        <Table size="small">
          <caption className="sr-only">{t('Admin.queuesTitle')}</caption>
          <TableHead>
            <TableRow>
              <TableCell>{t('Admin.queue')}</TableCell>
              {COUNTERS.map((counter) => (
                <TableCell key={counter} align="right">
                  {t(`Admin.counters.${counter}`)}
                </TableCell>
              ))}
              <TableCell align="right">{t('Common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {queues.map((queue) => (
              <TableRow key={queue.name} selected={selected?.queue === queue.name}>
                <TableCell>
                  <code>{queue.name}</code>{' '}
                  {queue.paused ? <StatusChip label={t('Admin.paused')} tone="warning" /> : null}
                </TableCell>
                {COUNTERS.map((counter) => (
                  <TableCell key={counter} align="right">
                    {counter === 'failed' && queue.failed > 0 ? (
                      <StatusChip label={String(queue.failed)} tone="error" />
                    ) : (
                      queue[counter]
                    )}
                  </TableCell>
                ))}
                <TableCell align="right">
                  <Button
                    size="small"
                    disabled={pending || queue.failed === 0}
                    onClick={() => load(queue.name)}
                  >
                    {t('Admin.viewFailed')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {selected ? (
        <section aria-labelledby="failed-jobs-title" className="flex flex-col gap-3">
          <Typography id="failed-jobs-title" variant="h2" className="text-xl">
            {t('Admin.failedTitle', { queue: selected.queue })}
          </Typography>
          {selected.jobs.length === 0 ? (
            <EmptyState message={t('Admin.noFailed')} />
          ) : (
            <TableContainer className="rounded-lg border border-line">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('Admin.job')}</TableCell>
                    <TableCell>{t('Admin.reason')}</TableCell>
                    <TableCell align="right">{t('Admin.attempts')}</TableCell>
                    <TableCell>{t('Admin.failedAt')}</TableCell>
                    <TableCell align="right">{t('Common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {selected.jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div className="font-mono text-sm break-all">{job.id}</div>
                        <div className="text-sm text-ink-muted">
                          {job.name}
                          {job.tenantId ? ` · ${t('Admin.tenant')} ${job.tenantId}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md break-words">{job.failedReason}</TableCell>
                      <TableCell align="right">{job.attemptsMade}</TableCell>
                      <TableCell>
                        {job.failedAt ? `${dateTime.format(new Date(job.failedAt))} UTC` : '—'}
                      </TableCell>
                      <TableCell align="right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="small"
                            disabled={pending}
                            onClick={() =>
                              act(retryJobAction, selected.queue, job.id, t('Admin.retried'))
                            }
                          >
                            {t('Admin.retry')}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            disabled={pending}
                            onClick={() =>
                              act(removeJobAction, selected.queue, job.id, t('Admin.removed'))
                            }
                          >
                            {t('Admin.discard')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </section>
      ) : null}
    </div>
  );
}
