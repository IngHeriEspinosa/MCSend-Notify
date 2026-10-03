'use client';

/** Aprobaciones de campañas generadas por automatizaciones (pendientes primero). */
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/common/i18n/navigation';
import { StatusChip } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import type { ApprovalRecord, ApprovalStatus } from '@/core/automations/automation';

const TONE: Record<ApprovalStatus, 'warning' | 'success' | 'default'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'default',
  EXPIRED: 'default',
};

export function ApprovalsTable({
  tenantSlug,
  approvals,
  timeZone,
}: {
  tenantSlug: string;
  approvals: ApprovalRecord[];
  timeZone: string;
}) {
  const t = useTranslations('Approvals');
  const locale = useLocale();
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
  const sorted = [...approvals].sort(
    (a, b) =>
      Number(b.status === 'PENDING') - Number(a.status === 'PENDING') ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );

  if (sorted.length === 0) return <EmptyState message={t('empty')} />;

  return (
    <TableContainer className="rounded-lg border border-line">
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>{t('automation')}</TableCell>
            <TableCell>{t('requested')}</TableCell>
            <TableCell>{t('expires')}</TableCell>
            <TableCell>{t('status')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((approval) => (
            <TableRow key={approval.id} hover>
              <TableCell>
                <Link
                  href={`/t/${tenantSlug}/approvals/${approval.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {approval.automationName}
                </Link>
              </TableCell>
              <TableCell>{dateFormat.format(approval.createdAt)}</TableCell>
              <TableCell>
                {approval.status === 'PENDING' ? dateFormat.format(approval.expiresAt) : '—'}
              </TableCell>
              <TableCell>
                <StatusChip label={t(`statuses.${approval.status}`)} tone={TONE[approval.status]} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
