/** Importación de contactos: carga de archivo e historial reciente. */
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { Link } from '@/common/i18n/navigation';
import { StatusChip } from '@/components/atoms/StatusChip';
import { PageHeader } from '@/components/molecules/PageHeader';
import { ImportUploader } from '@/components/organisms/ImportUploader';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

const STATUS_TONE = {
  UPLOADED: 'default',
  QUEUED: 'info',
  PROCESSING: 'info',
  COMPLETED: 'success',
  FAILED: 'error',
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Import');
  return { title: t('title') };
}

export default async function ImportPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/contacts/import'>) {
  const { locale, tenantSlug } = await params;
  const { context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'contact:import')) notFound();
  const t = await getTranslations('Import');
  const recent = await useCases.getImport().listRecent(context);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <>
      <PageHeader title={t('title')} />
      <ImportUploader tenantSlug={tenantSlug} />
      {recent.length > 0 ? (
        <section className="mt-10 flex flex-col gap-3">
          <Typography variant="h6" component="h2">
            {t('recent')}
          </Typography>
          <TableContainer className="rounded-lg border border-line">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('file')}</TableCell>
                  <TableCell>{t('created')}</TableCell>
                  <TableCell>{t('totalRows')}</TableCell>
                  <TableCell>{t('invalid')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {recent.map((item) => (
                  <TableRow key={item.id} hover>
                    <TableCell>
                      <Link
                        href={`/t/${tenantSlug}/contacts/import/${item.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {item.fileName}
                      </Link>
                      <Typography variant="body2" color="text.secondary">
                        {dateFormat.format(item.createdAt)}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.createdCount}</TableCell>
                    <TableCell>{item.totalRows}</TableCell>
                    <TableCell>{item.invalidCount}</TableCell>
                    <TableCell align="right">
                      <StatusChip
                        label={t(`statuses.${item.status}`)}
                        tone={STATUS_TONE[item.status]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </section>
      ) : null}
    </>
  );
}
