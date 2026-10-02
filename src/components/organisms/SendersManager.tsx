'use client';

/** Remitentes (From) del tenant con su proveedor y la comprobación DNS de SPF, DKIM y DMARC. */
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import DnsOutlined from '@mui/icons-material/DnsOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  checkSenderDnsAction,
  createSenderAction,
  deleteSenderAction,
  updateSenderAction,
} from '@/app/_server/actions/providers.actions';
import { useAction } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import type { DnsRecordStatus, ProviderView, SenderView } from '@/core/providers/provider-config';

const DNS_TONE: Record<DnsRecordStatus, 'success' | 'warning' | 'error'> = {
  pass: 'success',
  missing: 'warning',
  fail: 'error',
};

interface SendersManagerProps {
  tenantSlug: string;
  senders: SenderView[];
  providers: Array<Pick<ProviderView, 'id' | 'name' | 'kind'>>;
}

type Editing = { mode: 'create' } | { mode: 'edit'; sender: SenderView } | null;

export function SendersManager({ tenantSlug, senders, providers }: SendersManagerProps) {
  const t = useTranslations();
  const { run, pending, fieldErrors } = useAction();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<SenderView | null>(null);
  const current = editing?.mode === 'edit' ? editing.sender : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sender = {
      providerConfigId: String(form.get('providerConfigId') ?? ''),
      fromName: String(form.get('fromName') ?? ''),
      fromEmail: String(form.get('fromEmail') ?? ''),
      replyTo: String(form.get('replyTo') ?? '').trim() || null,
      isDefault: form.get('isDefault') === 'on',
    };
    void run(
      () =>
        current
          ? updateSenderAction(tenantSlug, { id: current.id, sender })
          : createSenderAction(tenantSlug, sender),
      { successMessage: t('Common.saved'), onSuccess: () => setEditing(null) },
    );
  };

  const dns = (sender: SenderView) => {
    if (!sender.dnsCheck) {
      return <StatusChip label={t('Senders.dnsUnchecked')} />;
    }
    const check = sender.dnsCheck;
    return (
      <div className="flex flex-wrap gap-1" aria-label={t('Senders.dns')}>
        {(['spf', 'dkim', 'dmarc'] as const).map((record) => (
          <StatusChip
            key={record}
            label={`${record.toUpperCase()}: ${t(`Senders.dnsStatus.${check[record]}`)}`}
            tone={DNS_TONE[check[record]]}
          />
        ))}
      </div>
    );
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          variant="contained"
          disabled={providers.length === 0}
          onClick={() => setEditing({ mode: 'create' })}
        >
          {t('Senders.new')}
        </Button>
      </div>
      {providers.length === 0 ? (
        <Typography color="text.secondary" className="mb-4">
          {t('Senders.needsProvider')}
        </Typography>
      ) : null}

      {senders.length === 0 ? (
        <EmptyState message={t('Senders.empty')} />
      ) : (
        <TableContainer className="rounded-lg border border-line">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('Senders.from')}</TableCell>
                <TableCell>{t('Senders.provider')}</TableCell>
                <TableCell>{t('Senders.dns')}</TableCell>
                <TableCell align="right">{t('Common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {senders.map((sender) => (
                <TableRow key={sender.id} hover>
                  <TableCell>
                    <span className="font-medium">{sender.fromName}</span>
                    <Typography variant="body2" color="text.secondary">
                      {sender.fromEmail}
                      {sender.isDefault ? ` · ${t('Senders.default')}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>{sender.providerName}</TableCell>
                  <TableCell>{dns(sender)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">
                    <IconButton
                      aria-label={`${t('Senders.checkDns')}: ${sender.fromEmail}`}
                      disabled={pending}
                      onClick={() =>
                        void run(() => checkSenderDnsAction(tenantSlug, { id: sender.id }), {
                          successMessage: t('Senders.dnsChecked'),
                        })
                      }
                    >
                      <DnsOutlined />
                    </IconButton>
                    <IconButton
                      aria-label={`${t('Common.edit')}: ${sender.fromEmail}`}
                      onClick={() => setEditing({ mode: 'edit', sender })}
                    >
                      <EditOutlined />
                    </IconButton>
                    <IconButton
                      aria-label={`${t('Common.delete')}: ${sender.fromEmail}`}
                      onClick={() => setDeleting(sender)}
                    >
                      <DeleteOutlined />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Typography variant="body2" color="text.secondary" className="mt-4">
        {t('Senders.dnsHelp')}
      </Typography>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <form onSubmit={submit} noValidate key={current?.id ?? 'new'}>
          <DialogTitle>{current ? t('Senders.edit') : t('Senders.new')}</DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            <TextField
              select
              name="providerConfigId"
              label={t('Senders.provider')}
              defaultValue={current?.providerConfigId ?? providers[0]?.id ?? ''}
              fullWidth
              margin="dense"
            >
              {providers.map((provider) => (
                <MenuItem key={provider.id} value={provider.id}>
                  {provider.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              name="fromName"
              label={t('Senders.fromName')}
              defaultValue={current?.fromName ?? ''}
              required
              fullWidth
              error={Boolean(fieldErrors.fromName)}
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <TextField
              name="fromEmail"
              type="email"
              label={t('Senders.fromEmail')}
              defaultValue={current?.fromEmail ?? ''}
              required
              fullWidth
              error={Boolean(fieldErrors.fromEmail)}
              helperText={t('Senders.fromEmailHint')}
            />
            <TextField
              name="replyTo"
              type="email"
              label={t('Senders.replyTo')}
              defaultValue={current?.replyTo ?? ''}
              fullWidth
              error={Boolean(fieldErrors.replyTo)}
            />
            <FormControlLabel
              control={
                <Switch
                  name="isDefault"
                  defaultChecked={current?.isDefault ?? senders.length === 0}
                />
              }
              label={t('Senders.makeDefault')}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditing(null)}>{t('Common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {pending ? t('Common.saving') : t('Common.save')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={t('Senders.deleteTitle')}
        body={t('Senders.deleteBody')}
        confirmLabel={t('Common.delete')}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          void run(() => deleteSenderAction(tenantSlug, { id: deleting.id }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => setDeleting(null),
          })
        }
      />
    </>
  );
}
