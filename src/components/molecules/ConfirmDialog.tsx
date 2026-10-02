'use client';

/** Diálogo de confirmación para acciones destructivas. */
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pending,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const t = useTranslations('Common');
  const titleId = useId();
  const bodyId = useId();
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} aria-describedby={bodyId}>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={bodyId}>{body}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button color="error" variant="contained" disabled={pending} onClick={onConfirm}>
          {confirmLabel ?? t('delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
