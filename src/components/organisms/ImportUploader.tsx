'use client';

/** Zona de carga de archivos de importación (arrastrar y soltar o selector accesible por teclado). */
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type DragEvent } from 'react';
import { useNotify } from '@/common/hooks/notifications';
import { useRouter } from '@/common/i18n/navigation';

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const IMPORT_ERROR_REASONS = new Set(['FILE_SIZE', 'FILE_TYPE', 'NO_HEADERS']);

interface UploadErrorBody {
  error?: { code?: string; details?: { reason?: string } };
}

export function ImportUploader({ tenantSlug }: { tenantSlug: string }) {
  const t = useTranslations();
  const router = useRouter();
  const notify = useNotify();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`/api/t/${tenantSlug}/imports`, { method: 'POST', body });
      if (response.ok) {
        const { importId } = (await response.json()) as { importId: string };
        router.push(`/t/${tenantSlug}/contacts/import/${importId}`);
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as UploadErrorBody;
      const reason = payload.error?.details?.reason;
      const code = payload.error?.code;
      notify(
        reason && IMPORT_ERROR_REASONS.has(reason)
          ? t(`Import.errors.${reason as 'FILE_SIZE' | 'FILE_TYPE' | 'NO_HEADERS'}`)
          : code === 'RATE_LIMITED' || code === 'FORBIDDEN' || code === 'NOT_FOUND'
            ? t(`Errors.${code}`)
            : t('Errors.UNEXPECTED', { traceId: '-' }),
        'error',
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !uploading) void upload(file);
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors focus-within:outline-3 focus-within:outline-secondary ${
          dragging ? 'border-primary bg-surface' : 'border-line bg-paper hover:border-primary'
        }`}
      >
        <UploadFileOutlined fontSize="large" className="text-primary" aria-hidden />
        <Typography>{uploading ? t('Import.uploading') : t('Import.dropzone')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('Import.subtitle')}
        </Typography>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      {uploading ? <LinearProgress aria-label={t('Import.uploading')} /> : null}
    </div>
  );
}
