'use client';

/**
 * Biblioteca de documentos: subida, búsqueda, filtro por tipo y cuadrícula de miniaturas.
 * Mientras haya documentos en proceso consulta su estado cada pocos segundos y refresca la
 * página cuando alguno termina.
 */
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { documentStatusesAction } from '@/app/_server/actions/documents.actions';
import { useNotify } from '@/common/hooks/notifications';
import { useRouter } from '@/common/i18n/navigation';
import { StatusChip } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import { FileDropzone } from '@/components/molecules/FileDropzone';
import { LinkCardArea } from '@/components/molecules/LinkButton';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_STATUS_TONE,
  documentThumbnailUrl,
  formatBytes,
} from '@/common/utils/documents-ui';
import { DOCUMENT_KINDS, type DocumentKind, type DocumentSummary } from '@/core/documents/document';

const POLL_MS = 3000;
const UPLOAD_ERROR_REASONS = new Set(['FILE_SIZE', 'FILE_TYPE']);

interface UploadErrorBody {
  error?: { code?: string; details?: { reason?: string } };
}

interface DocumentsManagerProps {
  tenantSlug: string;
  documents: DocumentSummary[];
  canWrite: boolean;
}

export function DocumentsManager({ tenantSlug, documents, canWrite }: DocumentsManagerProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const notify = useNotify();
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<DocumentKind | 'ALL'>('ALL');

  const pendingIds = useMemo(
    () =>
      documents
        .filter((document) => document.status === 'UPLOADED' || document.status === 'PROCESSING')
        .map((document) => document.id),
    [documents],
  );

  useEffect(() => {
    if (pendingIds.length === 0) return;
    const timer = setInterval(async () => {
      const result = await documentStatusesAction(tenantSlug, { documentIds: pendingIds });
      if (!result.ok) return;
      const finished = result.data.some(
        (item) => item.status === 'READY' || item.status === 'FAILED',
      );
      if (finished) router.refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pendingIds, router, tenantSlug]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`/api/t/${tenantSlug}/documents`, { method: 'POST', body });
      if (response.ok) {
        notify(t('Documents.uploaded'), 'success');
        router.refresh();
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as UploadErrorBody;
      const reason = payload.error?.details?.reason;
      const code = payload.error?.code;
      notify(
        reason && UPLOAD_ERROR_REASONS.has(reason)
          ? t(`Documents.errors.${reason as 'FILE_SIZE' | 'FILE_TYPE'}`)
          : code === 'RATE_LIMITED' || code === 'FORBIDDEN' || code === 'NOT_FOUND'
            ? t(`Errors.${code}`)
            : t('Errors.UNEXPECTED', { traceId: '-' }),
        'error',
      );
    } finally {
      setUploading(false);
    }
  };

  const term = search.trim().toLowerCase();
  const visible = documents.filter(
    (document) =>
      (kind === 'ALL' || document.kind === kind) &&
      (term === '' ||
        document.title.toLowerCase().includes(term) ||
        document.fileName.toLowerCase().includes(term)),
  );

  return (
    <div className="flex flex-col gap-6">
      {canWrite ? (
        <FileDropzone
          accept={DOCUMENT_ACCEPT}
          label={t('Documents.dropzone')}
          hint={t('Documents.dropzoneHint')}
          busyLabel={t('Documents.uploading')}
          busy={uploading}
          onFile={upload}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <TextField
          label={t('Common.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          size="small"
          className="sm:w-72"
        />
        <TextField
          select
          label={t('Documents.kind')}
          value={kind}
          onChange={(event) => setKind(event.target.value as DocumentKind | 'ALL')}
          size="small"
          className="sm:w-56"
        >
          <MenuItem value="ALL">{t('Common.all')}</MenuItem>
          {DOCUMENT_KINDS.map((item) => (
            <MenuItem key={item} value={item}>
              {t(`Documents.kinds.${item}`)}
            </MenuItem>
          ))}
        </TextField>
      </div>

      {visible.length === 0 ? (
        <EmptyState message={t('Documents.empty')} />
      ) : (
        <ul
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          aria-label={t('Documents.title')}
        >
          {visible.map((document) => (
            <li key={document.id}>
              <Card variant="outlined" className="h-full">
                <LinkCardArea href={`/t/${tenantSlug}/documents/${document.id}`} className="h-full">
                  <div className="flex aspect-video items-center justify-center overflow-hidden border-b border-line bg-surface">
                    {document.status === 'READY' && document.thumbnailKey ? (
                      <Image
                        src={documentThumbnailUrl(tenantSlug, document)}
                        alt=""
                        width={document.thumbnailWidth ?? 1200}
                        height={document.thumbnailHeight ?? 675}
                        unoptimized
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <ArticleOutlined fontSize="large" className="text-ink-muted" aria-hidden />
                    )}
                  </div>
                  <CardContent className="flex flex-col gap-2">
                    <Typography
                      component="h2"
                      variant="subtitle1"
                      className="line-clamp-2 font-semibold"
                    >
                      {document.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {[
                        t(`Documents.kinds.${document.kind}`),
                        document.pageCount
                          ? t('Documents.pages', { count: document.pageCount })
                          : null,
                        formatBytes(document.sizeBytes, locale),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Typography>
                    <div>
                      <StatusChip
                        label={t(`Documents.statuses.${document.status}`)}
                        tone={DOCUMENT_STATUS_TONE[document.status]}
                      />
                    </div>
                  </CardContent>
                </LinkCardArea>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
