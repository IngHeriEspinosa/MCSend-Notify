'use client';

/** Campo de solo lectura con botón de copiar (enlaces de invitación, claves de API). */
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { useTranslations } from 'next-intl';
import { useNotify } from '@/common/hooks/notifications';

export function CopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations('Common');
  const notify = useNotify();

  const copy = async () => {
    await navigator.clipboard.writeText(value);
    notify(t('copied'), 'info');
  };

  return (
    <TextField
      label={label}
      value={value}
      fullWidth
      slotProps={{
        input: {
          readOnly: true,
          className: 'font-mono text-sm',
          endAdornment: (
            <InputAdornment position="end">
              <IconButton aria-label={t('copy')} onClick={() => void copy()} edge="end">
                <ContentCopyOutlined />
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
