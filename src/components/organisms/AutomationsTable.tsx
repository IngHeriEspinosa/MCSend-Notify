'use client';

/** Listado de automatizaciones con su programación, estado y última ejecución. */
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/common/i18n/navigation';
import { describeSchedule, RUN_STATUS_TONE } from '@/common/utils/automations-ui';
import { StatusChip } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import type { AutomationSummary } from '@/core/automations/automation';

export function AutomationsTable({
  tenantSlug,
  automations,
  timeZone,
}: {
  tenantSlug: string;
  automations: AutomationSummary[];
  timeZone: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });

  if (automations.length === 0) return <EmptyState message={t('Automations.empty')} />;

  return (
    <TableContainer className="rounded-lg border border-line">
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>{t('Common.name')}</TableCell>
            <TableCell>{t('Automations.frequency')}</TableCell>
            <TableCell>{t('Campaigns.status')}</TableCell>
            <TableCell>{t('Automations.lastRun')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {automations.map((automation) => (
            <TableRow key={automation.id} hover>
              <TableCell>
                <Link
                  href={`/t/${tenantSlug}/automations/${automation.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {automation.name}
                </Link>
              </TableCell>
              <TableCell>
                {describeSchedule(automation.schedule, locale, (key, values) =>
                  t(`Automations.schedules.${key}`, values),
                )}{' '}
                ({automation.timezone})
              </TableCell>
              <TableCell>
                <StatusChip
                  label={automation.enabled ? t('Automations.active') : t('Automations.inactive')}
                  tone={automation.enabled ? 'success' : 'default'}
                />
              </TableCell>
              <TableCell>
                {automation.lastRunAt ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {dateFormat.format(automation.lastRunAt)}
                    {automation.lastRunStatus ? (
                      <StatusChip
                        label={t(`Automations.runStatuses.${automation.lastRunStatus}`)}
                        tone={RUN_STATUS_TONE[automation.lastRunStatus]}
                      />
                    ) : null}
                  </span>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
