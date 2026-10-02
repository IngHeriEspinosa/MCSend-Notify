'use client';

/** Claves de API: creación (la clave se muestra una sola vez), permisos, caducidad y revocación. */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormLabel from '@mui/material/FormLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { createApiKeyAction, revokeApiKeyAction } from '@/app/_server/actions/settings.actions';
import { useAction } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { CopyField } from '@/components/molecules/CopyField';
import { EmptyState } from '@/components/molecules/EmptyState';
import { API_SCOPES, type ApiScope } from '@/core/api-keys/api-scopes';
import type { ApiKeyView } from '@/core/api-keys/api-keys';

const EXPIRY_OPTIONS = ['30', '90', '365', 'never'] as const;

export function ApiKeysManager({
  tenantSlug,
  apiKeys,
}: {
  tenantSlug: string;
  apiKeys: ApiKeyView[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { run, pending, fieldErrors } = useAction();
  const [open, setOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [scopes, setScopes] = useState<ApiScope[]>(['contacts:write']);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const formatDate = (date: Date | null) =>
    date ? dateFormat.format(new Date(date)) : t('Common.never');

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const expiry = String(form.get('expiry') ?? 'never');
    void run(
      () =>
        createApiKeyAction(tenantSlug, {
          name: String(form.get('name') ?? ''),
          scopes,
          expiresInDays: expiry === 'never' ? null : Number(expiry),
        }),
      { onSuccess: (data) => setCreatedKey(data.key) },
    );
  };

  const close = () => {
    setOpen(false);
    setCreatedKey(null);
    setScopes(['contacts:write']);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="contained" onClick={() => setOpen(true)}>
          {t('Settings.newApiKey')}
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <EmptyState message={t('Common.none')} />
      ) : (
        <TableContainer className="rounded-lg border border-line">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('Common.name')}</TableCell>
                <TableCell>{t('Settings.scopes')}</TableCell>
                <TableCell>{t('Settings.lastUsed')}</TableCell>
                <TableCell>{t('Settings.expires')}</TableCell>
                <TableCell align="right">{t('Common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {apiKeys.map((apiKey) => (
                <TableRow key={apiKey.id}>
                  <TableCell>
                    <div className="font-semibold">{apiKey.name}</div>
                    <code className="text-sm text-ink-muted">mcsn_{apiKey.prefix}_…</code>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {apiKey.scopes.map((scope) => (
                        <StatusChip key={scope} label={t(`Settings.scopeNames.${scope}`)} />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(apiKey.lastUsedAt)}</TableCell>
                  <TableCell>
                    {apiKey.expiresAt ? formatDate(apiKey.expiresAt) : t('Settings.noExpiry')}
                  </TableCell>
                  <TableCell align="right">
                    {apiKey.revokedAt ? (
                      <StatusChip label={t('Settings.revoked')} tone="error" />
                    ) : (
                      <Button color="error" size="small" onClick={() => setRevoking(apiKey)}>
                        {t('Settings.revoke')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        {createdKey ? (
          <>
            <DialogTitle>{t('Settings.keyCreatedTitle')}</DialogTitle>
            <DialogContent className="flex flex-col gap-4">
              <Alert severity="warning">{t('Settings.keyCreatedBody')}</Alert>
              <CopyField label={t('Settings.apiKeysTitle')} value={createdKey} />
            </DialogContent>
            <DialogActions>
              <Button onClick={close}>{t('Common.close')}</Button>
            </DialogActions>
          </>
        ) : (
          <form onSubmit={create} noValidate>
            <DialogTitle>{t('Settings.newApiKey')}</DialogTitle>
            <DialogContent className="flex flex-col gap-4 pt-2">
              <TextField
                name="name"
                label={t('Common.name')}
                required
                autoFocus
                fullWidth
                margin="dense"
                error={Boolean(fieldErrors.name)}
                slotProps={{ htmlInput: { maxLength: 80 } }}
              />
              <FormControl component="fieldset" error={Boolean(fieldErrors.scopes)}>
                <FormLabel component="legend">{t('Settings.scopes')}</FormLabel>
                <FormGroup>
                  {API_SCOPES.map((scope) => (
                    <FormControlLabel
                      key={scope}
                      label={t(`Settings.scopeNames.${scope}`)}
                      control={
                        <Checkbox
                          checked={scopes.includes(scope)}
                          onChange={(event) =>
                            setScopes((current) =>
                              event.target.checked
                                ? [...current, scope]
                                : current.filter((item) => item !== scope),
                            )
                          }
                        />
                      }
                    />
                  ))}
                </FormGroup>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel id="api-key-expiry">{t('Settings.expiresInDays')}</InputLabel>
                <Select
                  labelId="api-key-expiry"
                  name="expiry"
                  label={t('Settings.expiresInDays')}
                  defaultValue="365"
                >
                  {EXPIRY_OPTIONS.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option === 'never' ? t('Settings.noExpiry') : option}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </DialogContent>
            <DialogActions>
              <Button onClick={close}>{t('Common.cancel')}</Button>
              <Button type="submit" variant="contained" disabled={pending || scopes.length === 0}>
                {t('Common.create')}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={revoking !== null}
        title={t('Settings.revokeKeyTitle')}
        body={t('Settings.revokeKeyBody')}
        confirmLabel={t('Settings.revoke')}
        pending={pending}
        onClose={() => setRevoking(null)}
        onConfirm={() =>
          revoking &&
          void run(() => revokeApiKeyAction(tenantSlug, { id: revoking.id }), {
            successMessage: t('Common.saved'),
            onSuccess: () => setRevoking(null),
          })
        }
      />
    </div>
  );
}
