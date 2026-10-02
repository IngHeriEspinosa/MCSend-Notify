/** Detalle de un documento: miniatura, datos, texto extraído y acciones. */
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/app/_server/session';
import {
  DOCUMENT_STATUS_TONE,
  documentThumbnailUrl,
  formatBytes,
} from '@/common/utils/documents-ui';
import { StatusChip } from '@/components/atoms/StatusChip';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { DocumentActions } from '@/components/organisms/DocumentActions';
import { DOCUMENT_ERROR_CODES, type DocumentErrorCode } from '@/core/documents/document';
import { can } from '@/core/identity/permissions';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

const TEXT_PREVIEW_CHARS = 4000;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Documents');
  return { title: t('detailTitle') };
}

function isErrorCode(value: string | null): value is DocumentErrorCode {
  return value !== null && (DOCUMENT_ERROR_CODES as readonly string[]).includes(value);
}

export default async function DocumentDetailPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/documents/[documentId]'>) {
  const { locale, tenantSlug, documentId } = await params;
  if (!z.uuid().safeParse(documentId).success) notFound();
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'document:read')) notFound();
  const t = await getTranslations();
  const document = await useCases
    .documents()
    .get(context, documentId)
    .catch((error: unknown) => {
      if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    });
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: tenant.timezone,
  });
  const facts: Array<[string, string]> = [
    [t('Documents.kind'), t(`Documents.kinds.${document.kind}`)],
    [t('Documents.fileName'), document.fileName],
    [t('Documents.size'), formatBytes(document.sizeBytes, locale)],
    ...(document.pageCount
      ? ([[t('Documents.pageCount'), String(document.pageCount)]] as Array<[string, string]>)
      : []),
    [t('Common.createdAt'), dateFormat.format(document.createdAt)],
  ];

  return (
    <>
      <PageHeader
        title={document.title}
        actions={
          <LinkButton href={`/t/${tenantSlug}/documents`} variant="outlined">
            {t('Common.back')}
          </LinkButton>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Paper variant="outlined" className="flex items-center justify-center overflow-hidden p-2">
          {document.status === 'READY' && document.thumbnailKey ? (
            <Image
              src={documentThumbnailUrl(tenantSlug, document)}
              alt={t('Documents.thumbnailAlt', { title: document.title })}
              width={document.thumbnailWidth ?? 1200}
              height={document.thumbnailHeight ?? 675}
              unoptimized
              priority
              className="h-auto w-full"
            />
          ) : (
            <Typography color="text.secondary" className="py-24">
              {t(`Documents.statusHelp.${document.status}`)}
            </Typography>
          )}
        </Paper>
        <div className="flex flex-col gap-4">
          <div>
            <StatusChip
              label={t(`Documents.statuses.${document.status}`)}
              tone={DOCUMENT_STATUS_TONE[document.status]}
            />
          </div>
          {document.status === 'FAILED' && isErrorCode(document.error) ? (
            <Typography color="error" role="alert">
              {t(`Documents.processingErrors.${document.error}`)}
            </Typography>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-medium text-ink-muted">{label}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
          </dl>
          <DocumentActions
            tenantSlug={tenantSlug}
            document={{
              id: document.id,
              title: document.title,
              status: document.status,
              hasPdf:
                document.status === 'READY' &&
                (document.pdfKey !== null || document.kind === 'PDF'),
            }}
            canWrite={can(context.actor, 'document:write')}
          />
        </div>
      </div>
      {document.extractedText ? (
        <section className="mt-8 flex flex-col gap-2">
          <Typography variant="h6" component="h2">
            {t('Documents.extractedText')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('Documents.extractedTextHint')}
          </Typography>
          <Paper variant="outlined" className="max-h-96 overflow-auto p-4">
            <pre className="font-sans text-sm whitespace-pre-wrap">
              {document.extractedText.slice(0, TEXT_PREVIEW_CHARS)}
            </pre>
          </Paper>
        </section>
      ) : null}
    </>
  );
}
