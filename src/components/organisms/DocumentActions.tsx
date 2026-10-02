'use client';

/** Acciones sobre un documento: descargar, renombrar, reintentar y eliminar. */
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  deleteDocumentAction,
  renameDocumentAction,
  retryDocumentAction,
} from '@/app/_server/actions/documents.actions';
import { useAction } from '@/common/hooks/use-action';
import { useRouter } from '@/common/i18n/navigation';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import type { DocumentStatus } from '@/core/documents/document';

interface DocumentActionsProps {
  tenantSlug: string;
  document: { id: string; title: string; status: DocumentStatus; hasPdf: boolean };
  canWrite: boolean;
}

export function DocumentActions({ tenantSlug, document, canWrite }: DocumentActionsProps) {
  const t = useTranslations();
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileUrl = (variant: 'original' | 'pdf') =>
    `/api/t/${tenantSlug}/documents/${document.id}/file?variant=${variant}`;

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get('title') ?? '');
    void run(() => renameDocumentAction(tenantSlug, { documentId: document.id, title }), {
      successMessage: t('Common.saved'),
      onSuccess: () => setRenaming(false),
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="contained" startIcon={<DownloadOutlined />} href={fileUrl('original')}>
        {t('Documents.downloadOriginal')}
      </Button>
      {document.hasPdf ? (
        <Button
          variant="outlined"
          startIcon={<PictureAsPdfOutlined />}
          href={fileUrl('pdf')}
          target="_blank"
          rel="noopener"
        >
          {t('Documents.openPdf')}
        </Button>
      ) : null}
      {canWrite ? (
        <>
          <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => setRenaming(true)}>
            {t('Documents.rename')}
          </Button>
          {document.status === 'FAILED' ? (
            <Button
              variant="outlined"
              startIcon={<ReplayOutlined />}
              disabled={pending}
              onClick={() =>
                void run(() => retryDocumentAction(tenantSlug, { documentId: document.id }), {
                  successMessage: t('Documents.retryQueued'),
                })
              }
            >
              {t('Documents.retry')}
            </Button>
          ) : null}
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteOutlined />}
            onClick={() => setDeleting(true)}
          >
            {t('Common.delete')}
          </Button>
        </>
      ) : null}

      <Dialog open={renaming} onClose={() => setRenaming(false)} fullWidth maxWidth="sm">
        <form onSubmit={rename} noValidate>
          <DialogTitle>{t('Documents.rename')}</DialogTitle>
          <DialogContent>
            <TextField
              name="title"
              label={t('Documents.documentTitle')}
              defaultValue={document.title}
              required
              autoFocus
              fullWidth
              margin="dense"
              error={Boolean(fieldErrors.title)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRenaming(false)}>{t('Common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {pending ? t('Common.saving') : t('Common.save')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        title={t('Documents.deleteTitle')}
        body={t('Documents.deleteBody')}
        confirmLabel={t('Common.delete')}
        pending={pending}
        onClose={() => setDeleting(false)}
        onConfirm={() =>
          void run(() => deleteDocumentAction(tenantSlug, { documentId: document.id }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => router.push(`/t/${tenantSlug}/documents`),
          })
        }
      />
    </div>
  );
}
