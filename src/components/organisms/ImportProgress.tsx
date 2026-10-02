'use client';

/** Progreso y resultado de una importación (consulta el estado cada 2 s mientras se procesa). */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { getImportStatusAction } from '@/app/_server/actions/imports.actions';
import { Link } from '@/common/i18n/navigation';
import { StatCard } from '@/components/molecules/StatCard';
import type { ImportStatus } from '@/core/contacts/ports';

interface ImportState {
  status: ImportStatus;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  invalidCount: number;
  hasErrorReport: boolean;
  error: string | null;
}

const POLL_INTERVAL_MS = 2000;
const KNOWN_ERRORS = new Set(['TOO_MANY_ROWS', 'PROCESSING_ERROR', 'MAPPING_MISSING']);

export function ImportProgress({
  tenantSlug,
  importId,
  initial,
}: {
  tenantSlug: string;
  importId: string;
  initial: ImportState;
}) {
  const t = useTranslations('Import');
  const locale = useLocale();
  const [state, setState] = useState(initial);
  const running = state.status === 'QUEUED' || state.status === 'PROCESSING';

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const result = await getImportStatusAction(tenantSlug, { importId });
      if (result.ok) setState(result.data);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, tenantSlug, importId]);

  const stats = [
    { label: t('totalRows'), value: state.totalRows },
    { label: t('created'), value: state.createdCount },
    { label: t('updated'), value: state.updatedCount },
    { label: t('skipped'), value: state.skippedCount },
    { label: t('invalid'), value: state.invalidCount },
  ];
  const reason =
    state.error && KNOWN_ERRORS.has(state.error)
      ? t(`errors.${state.error as 'TOO_MANY_ROWS' | 'PROCESSING_ERROR' | 'MAPPING_MISSING'}`)
      : (state.error ?? '');

  return (
    <div className="flex flex-col gap-6" aria-live="polite">
      {running ? (
        <div className="flex flex-col gap-2">
          <Alert severity="info">{t('progressTitle')}</Alert>
          <LinearProgress aria-label={t('progressTitle')} />
        </div>
      ) : null}
      {state.status === 'FAILED' ? <Alert severity="error">{t('failed', { reason })}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((item) => (
          <StatCard key={item.label} label={item.label} value={item.value} locale={locale} />
        ))}
      </div>

      {!running ? (
        <div className="flex flex-wrap gap-3">
          {state.hasErrorReport ? (
            <Button
              component="a"
              href={`/api/t/${tenantSlug}/imports/${importId}/errors`}
              variant="outlined"
              download
            >
              {t('downloadErrors')}
            </Button>
          ) : null}
          <Button component={Link} href={`/t/${tenantSlug}/contacts/import`} variant="contained">
            {t('newImport')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
