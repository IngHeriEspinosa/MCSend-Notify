/** Registro de actividad (auditoría inmutable) del tenant, paginado por URL. */
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/app/_server/session';
import { EmptyState } from '@/components/molecules/EmptyState';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

const PAGE_SIZE = 50;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Activity');
  return { title: t('title') };
}

export default async function ActivityPage({
  params,
  searchParams,
}: PageProps<'/[locale]/t/[tenantSlug]/activity'>) {
  const { locale, tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'audit:read')) notFound();
  const t = await getTranslations('Activity');
  const tCommon = await getTranslations('Common');

  const page = z.coerce
    .number()
    .int()
    .min(0)
    .catch(0)
    .parse((await searchParams).page);
  const result = await useCases.auditLog().execute(context, { page, pageSize: PAGE_SIZE });
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' });
  const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {result.items.length === 0 ? (
        <EmptyState message={tCommon('none')} />
      ) : (
        <TableContainer className="rounded-lg border border-line">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('date')}</TableCell>
                <TableCell>{t('actor')}</TableCell>
                <TableCell>{t('action')}</TableCell>
                <TableCell>{t('entity')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">
                    {dateFormat.format(entry.createdAt)}
                  </TableCell>
                  <TableCell>
                    {entry.actorUserEmail ?? (entry.actorApiKeyId ? t('apiKey') : t('system'))}
                  </TableCell>
                  <TableCell>
                    <code>{entry.action}</code>
                  </TableCell>
                  <TableCell className="text-ink-muted">
                    {entry.entityType}
                    {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <nav className="mt-4 flex justify-between" aria-label={t('title')}>
        <LinkButton href={`/t/${tenantSlug}/activity?page=${page - 1}`} disabled={page === 0}>
          {tCommon('back')}
        </LinkButton>
        <LinkButton href={`/t/${tenantSlug}/activity?page=${page + 1}`} disabled={page >= lastPage}>
          {tCommon('next')}
        </LinkButton>
      </nav>
    </>
  );
}
