/** Uso de IA del mes por tenant y coste cargado a la clave de la plataforma. Solo SUPER_ADMIN. */
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { requirePlatformAdmin } from '@/app/_server/session';
import { StatusChip } from '@/components/atoms/StatusChip';
import { PageHeader } from '@/components/molecules/PageHeader';
import { usageMonthSchema } from '@/core/platform/platform-admin';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Admin');
  return { title: t('aiUsageTitle') };
}

export default async function AdminAiUsagePage({
  searchParams,
}: PageProps<'/[locale]/admin/ai-usage'>) {
  const user = await requirePlatformAdmin();
  const t = await getTranslations('Admin');
  const format = await getFormatter();
  const { month } = await searchParams;
  const parsed = usageMonthSchema.safeParse(typeof month === 'string' ? month : undefined);
  const report = await useCases
    .platformAiUsage()
    .month(user, parsed.success ? parsed.data : undefined);
  const usd = (micros: number) =>
    format.number(micros / 1_000_000, { style: 'currency', currency: 'USD' });

  return (
    <>
      <PageHeader title={t('aiUsageTitle')} subtitle={t('aiUsageSubtitle')} />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <TextField
          type="month"
          name="month"
          label={t('month')}
          defaultValue={report.month}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: '2100-12' } }}
        />
        <Button type="submit" variant="outlined">
          {t('show')}
        </Button>
      </form>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          { label: t('platformCost'), value: usd(report.platformCostMicros) },
          { label: t('totalCost'), value: usd(report.totalCostMicros) },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-line bg-paper p-4">
            <dt className="text-sm text-ink-muted">{item.label}</dt>
            <dd className="text-2xl font-semibold">{item.value}</dd>
          </div>
        ))}
      </dl>
      <TableContainer className="rounded-lg border border-line">
        <Table size="small">
          <caption className="sr-only">{t('aiUsageTitle')}</caption>
          <TableHead>
            <TableRow>
              <TableCell>{t('tenant')}</TableCell>
              <TableCell>{t('aiSource')}</TableCell>
              <TableCell align="right">{t('calls')}</TableCell>
              <TableCell align="right">{t('errors')}</TableCell>
              <TableCell align="right">{t('tokens')}</TableCell>
              <TableCell align="right">{t('cost')}</TableCell>
              <TableCell align="right">{t('budget')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {report.rows.map((row) => {
              const budgetMicros =
                row.monthlyBudgetUsd === null ? null : row.monthlyBudgetUsd * 1_000_000;
              const over = budgetMicros !== null && row.costMicros >= budgetMicros;
              return (
                <TableRow key={row.tenantId}>
                  <TableCell>
                    <div className="font-semibold">{row.tenantName}</div>
                    <code className="text-sm text-ink-muted">{row.tenantSlug}</code>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      label={t(`aiSources.${row.source ?? 'NONE'}`)}
                      tone={row.source === 'PLATFORM' ? 'primary' : 'default'}
                    />
                  </TableCell>
                  <TableCell align="right">{format.number(row.calls)}</TableCell>
                  <TableCell align="right">{format.number(row.errors)}</TableCell>
                  <TableCell align="right">
                    {format.number(row.inputTokens + row.outputTokens)}
                  </TableCell>
                  <TableCell align="right">{usd(row.costMicros)}</TableCell>
                  <TableCell align="right">
                    {budgetMicros === null ? (
                      '—'
                    ) : over ? (
                      <StatusChip label={usd(budgetMicros)} tone="error" />
                    ) : (
                      usd(budgetMicros)
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
