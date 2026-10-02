'use client';

/** Tabla de segmentos con accesos a sus contactos, edición y borrado. */
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { deleteSegmentAction } from '@/app/_server/actions/audience.actions';
import { useAction } from '@/common/hooks/use-action';
import { Link } from '@/common/i18n/navigation';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';

interface SegmentRow {
  id: string;
  name: string;
  description: string | null;
  lastCount: number | null;
  lastCountedAt: Date | null;
}

export function SegmentsTable({
  tenantSlug,
  segments,
  canWrite,
}: {
  tenantSlug: string;
  segments: SegmentRow[];
  canWrite: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { run, pending } = useAction();
  const [deleting, setDeleting] = useState<SegmentRow | null>(null);
  const numberFormat = new Intl.NumberFormat(locale);

  if (segments.length === 0) return <EmptyState message={t('Segments.empty')} />;

  return (
    <>
      <TableContainer className="rounded-lg border border-line">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('Common.name')}</TableCell>
              <TableCell align="right">{t('Segments.lastCount')}</TableCell>
              <TableCell align="right">{t('Common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {segments.map((segment) => (
              <TableRow key={segment.id} hover>
                <TableCell>
                  <Link
                    href={`/t/${tenantSlug}/segments/${segment.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {segment.name}
                  </Link>
                  {segment.description ? (
                    <div className="text-sm text-ink-muted">{segment.description}</div>
                  ) : null}
                </TableCell>
                <TableCell align="right">
                  {segment.lastCount === null ? '-' : numberFormat.format(segment.lastCount)}
                </TableCell>
                <TableCell align="right">
                  <Button
                    component={Link}
                    href={`/t/${tenantSlug}/contacts?segmentId=${segment.id}`}
                    size="small"
                  >
                    {t('Segments.viewContacts')}
                  </Button>
                  {canWrite ? (
                    <IconButton
                      aria-label={`${t('Common.delete')}: ${segment.name}`}
                      onClick={() => setDeleting(segment)}
                    >
                      <DeleteOutlined />
                    </IconButton>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <ConfirmDialog
        open={deleting !== null}
        title={t('Common.deleteConfirmTitle')}
        body={t('Common.deleteConfirmBody')}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          void run(() => deleteSegmentAction(tenantSlug, { id: deleting.id }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => setDeleting(null),
          })
        }
      />
    </>
  );
}
