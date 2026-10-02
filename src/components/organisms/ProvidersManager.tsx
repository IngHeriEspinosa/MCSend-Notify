'use client';

/**
 * Proveedores de correo del tenant: alta y edición con formulario según el tipo, prueba de
 * conexión, proveedor por defecto y URL de webhooks (Resend y SES). Las credenciales guardadas
 * nunca se muestran: en edición, los campos vacíos conservan las actuales.
 */
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import NetworkCheckOutlined from '@mui/icons-material/NetworkCheckOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  createProviderAction,
  deleteProviderAction,
  updateProviderAction,
  verifyProviderAction,
} from '@/app/_server/actions/providers.actions';
import { useNotify } from '@/common/hooks/notifications';
import { useAction } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { CopyField } from '@/components/molecules/CopyField';
import { EmptyState } from '@/components/molecules/EmptyState';
import {
  EMAIL_PROVIDER_KINDS,
  PROVIDER_DEFAULTS,
  type EmailProviderKind,
  type ProviderView,
} from '@/core/providers/provider-config';

interface ProvidersManagerProps {
  tenantSlug: string;
  providers: ProviderView[];
  webhookBaseUrl: string;
}

type Editing = { mode: 'create' } | { mode: 'edit'; provider: ProviderView } | null;

const STATUS_TONE = { ACTIVE: 'success', ERROR: 'error', DISABLED: 'default' } as const;

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

function setting(provider: ProviderView | undefined, key: string): string {
  const value = provider?.settings[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/** Construye la entrada del caso de uso a partir del formulario según el tipo. */
function buildInput(kind: EmailProviderKind, form: FormData, editing: boolean) {
  const limits = {
    name: text(form, 'name'),
    rateLimitPerSecond: Number(text(form, 'rateLimitPerSecond')) || 1,
    maxPerDay: text(form, 'maxPerDay') ? Number(text(form, 'maxPerDay')) : null,
    isDefault: form.get('isDefault') === 'on',
  };
  const keep = (fields: string[]) => editing && fields.every((field) => text(form, field) === '');
  switch (kind) {
    case 'SMTP':
      return {
        ...limits,
        kind,
        settings: {
          host: text(form, 'host'),
          port: Number(text(form, 'port')) || 587,
          security: (text(form, 'security') || 'starttls') as 'tls' | 'starttls' | 'none',
        },
        credentials: keep(['username', 'password'])
          ? null
          : {
              username: text(form, 'username') || null,
              password: String(form.get('password') ?? '') || null,
            },
      };
    case 'MICROSOFT_GRAPH':
      return {
        ...limits,
        kind,
        settings: { azureTenantId: text(form, 'azureTenantId'), clientId: text(form, 'clientId') },
        credentials: keep(['clientSecret']) ? null : { clientSecret: text(form, 'clientSecret') },
      };
    case 'RESEND':
      return {
        ...limits,
        kind,
        settings: {},
        credentials: keep(['apiKey', 'webhookSecret'])
          ? null
          : { apiKey: text(form, 'apiKey'), webhookSecret: text(form, 'webhookSecret') || null },
      };
    case 'SES':
      return {
        ...limits,
        kind,
        settings: {
          region: text(form, 'region'),
          configurationSet: text(form, 'configurationSet') || null,
        },
        credentials: keep(['accessKeyId', 'secretAccessKey'])
          ? null
          : {
              accessKeyId: text(form, 'accessKeyId'),
              secretAccessKey: text(form, 'secretAccessKey'),
            },
      };
  }
}

export function ProvidersManager({ tenantSlug, providers, webhookBaseUrl }: ProvidersManagerProps) {
  const t = useTranslations();
  const locale = useLocale();
  const notify = useNotify();
  const { run, pending, fieldErrors } = useAction();
  const [editing, setEditing] = useState<Editing>(null);
  const [kind, setKind] = useState<EmailProviderKind>('SMTP');
  const [deleting, setDeleting] = useState<ProviderView | null>(null);
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
  const current = editing?.mode === 'edit' ? editing.provider : undefined;
  const secretHint = current ? t('Providers.keepSecret') : undefined;
  const defaults = PROVIDER_DEFAULTS[kind];

  const open = (next: Editing) => {
    setKind(next?.mode === 'edit' ? next.provider.kind : 'SMTP');
    setEditing(next);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = buildInput(kind, new FormData(event.currentTarget), current !== undefined);
    void run(
      () =>
        current
          ? updateProviderAction(tenantSlug, { id: current.id, provider: input })
          : createProviderAction(tenantSlug, input),
      { successMessage: t('Common.saved'), onSuccess: () => setEditing(null) },
    );
  };

  const verify = (provider: ProviderView) =>
    void run(() => verifyProviderAction(tenantSlug, { id: provider.id }), {
      onSuccess: (result) =>
        notify(
          result.ok
            ? t('Providers.verifyOk')
            : t('Providers.verifyFailed', { message: result.message }),
          result.ok ? 'success' : 'error',
        ),
    });

  const field = (
    name: string,
    label: string,
    options: {
      type?: string;
      defaultValue?: string;
      secret?: boolean;
      helper?: string;
      required?: boolean;
      step?: string;
    } = {},
  ) => (
    <TextField
      name={name}
      label={label}
      type={options.secret ? 'password' : (options.type ?? 'text')}
      defaultValue={options.secret ? '' : options.defaultValue}
      required={options.required ?? !options.secret}
      fullWidth
      autoComplete="off"
      error={Boolean(fieldErrors[name])}
      helperText={options.secret && current ? secretHint : options.helper}
      slotProps={
        options.step ? { htmlInput: { step: options.step, min: options.step } } : undefined
      }
    />
  );

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant="contained" onClick={() => open({ mode: 'create' })}>
          {t('Providers.new')}
        </Button>
      </div>

      {providers.length === 0 ? (
        <EmptyState message={t('Providers.empty')} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {providers.map((provider) => (
            <li key={provider.id}>
              <Card variant="outlined" className="h-full">
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Typography component="h2" variant="h6" className="mr-auto">
                      {provider.name}
                    </Typography>
                    <StatusChip label={t(`Providers.kinds.${provider.kind}`)} tone="primary" />
                    <StatusChip
                      label={t(`Providers.statuses.${provider.status}`)}
                      tone={STATUS_TONE[provider.status]}
                    />
                    {provider.isDefault ? (
                      <StatusChip label={t('Providers.default')} tone="info" />
                    ) : null}
                  </div>
                  <Typography variant="body2" color="text.secondary">
                    {t('Providers.limits', {
                      perSecond: numberFormat.format(provider.rateLimitPerSecond),
                      perDay: provider.maxPerDay ? numberFormat.format(provider.maxPerDay) : '∞',
                    })}
                    {' · '}
                    {provider.lastVerifiedAt
                      ? t('Providers.verifiedAt', {
                          date: `${dateFormat.format(provider.lastVerifiedAt)} UTC`,
                        })
                      : t('Providers.neverVerified')}
                  </Typography>
                  {provider.lastError ? <Alert severity="error">{provider.lastError}</Alert> : null}
                  {PROVIDER_DEFAULTS[provider.kind].supportsWebhooks ? (
                    <CopyField
                      label={t('Providers.webhookUrl')}
                      value={`${webhookBaseUrl}${provider.endpointToken}`}
                    />
                  ) : null}
                </CardContent>
                <CardActions className="flex-wrap">
                  <Button
                    startIcon={<NetworkCheckOutlined />}
                    disabled={pending}
                    onClick={() => verify(provider)}
                  >
                    {t('Providers.verify')}
                  </Button>
                  <Button
                    startIcon={<EditOutlined />}
                    onClick={() => open({ mode: 'edit', provider })}
                  >
                    {t('Common.edit')}
                  </Button>
                  <Button
                    color="error"
                    startIcon={<DeleteOutlined />}
                    onClick={() => setDeleting(provider)}
                  >
                    {t('Common.delete')}
                  </Button>
                </CardActions>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <form onSubmit={submit} noValidate key={current?.id ?? `new-${kind}`}>
          <DialogTitle>{current ? t('Providers.edit') : t('Providers.new')}</DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            <TextField
              select
              label={t('Providers.kind')}
              value={kind}
              onChange={(event) => setKind(event.target.value as EmailProviderKind)}
              disabled={current !== undefined}
              fullWidth
              margin="dense"
              helperText={t(`Providers.kindHints.${kind}`)}
            >
              {EMAIL_PROVIDER_KINDS.map((item) => (
                <MenuItem key={item} value={item}>
                  {t(`Providers.kinds.${item}`)}
                </MenuItem>
              ))}
            </TextField>
            {field('name', t('Common.name'), { defaultValue: current?.name ?? '' })}

            {kind === 'SMTP' ? (
              <>
                {field('host', t('Providers.fields.host'), {
                  defaultValue: setting(current, 'host'),
                })}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {field('port', t('Providers.fields.port'), {
                    type: 'number',
                    defaultValue: setting(current, 'port') || '587',
                  })}
                  <TextField
                    select
                    name="security"
                    label={t('Providers.fields.security')}
                    defaultValue={setting(current, 'security') || 'starttls'}
                    fullWidth
                  >
                    <MenuItem value="starttls">STARTTLS</MenuItem>
                    <MenuItem value="tls">TLS</MenuItem>
                    <MenuItem value="none">{t('Providers.fields.noTls')}</MenuItem>
                  </TextField>
                </div>
                {field('username', t('Providers.fields.username'), {
                  secret: true,
                  required: false,
                })}
                {field('password', t('Providers.fields.password'), {
                  secret: true,
                  required: false,
                })}
              </>
            ) : null}
            {kind === 'MICROSOFT_GRAPH' ? (
              <>
                {field('azureTenantId', t('Providers.fields.azureTenantId'), {
                  defaultValue: setting(current, 'azureTenantId'),
                })}
                {field('clientId', t('Providers.fields.clientId'), {
                  defaultValue: setting(current, 'clientId'),
                })}
                {field('clientSecret', t('Providers.fields.clientSecret'), { secret: true })}
              </>
            ) : null}
            {kind === 'RESEND' ? (
              <>
                {field('apiKey', t('Providers.fields.apiKey'), { secret: true })}
                {field('webhookSecret', t('Providers.fields.webhookSecret'), {
                  secret: true,
                  required: false,
                })}
              </>
            ) : null}
            {kind === 'SES' ? (
              <>
                {field('region', t('Providers.fields.region'), {
                  defaultValue: setting(current, 'region') || 'us-east-1',
                })}
                {field('configurationSet', t('Providers.fields.configurationSet'), {
                  defaultValue: setting(current, 'configurationSet'),
                  required: false,
                  helper: t('Providers.fields.configurationSetHint'),
                })}
                {field('accessKeyId', t('Providers.fields.accessKeyId'), { secret: true })}
                {field('secretAccessKey', t('Providers.fields.secretAccessKey'), { secret: true })}
              </>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field('rateLimitPerSecond', t('Providers.fields.rateLimitPerSecond'), {
                type: 'number',
                step: '0.1',
                defaultValue: String(current?.rateLimitPerSecond ?? defaults.rateLimitPerSecond),
                helper: t('Providers.fields.rateLimitPerSecondHint'),
              })}
              {field('maxPerDay', t('Providers.fields.maxPerDay'), {
                type: 'number',
                defaultValue: String(current?.maxPerDay ?? defaults.maxPerDay ?? ''),
                required: false,
                helper: t('Providers.fields.maxPerDayHint'),
              })}
            </div>
            <FormControlLabel
              control={
                <Switch
                  name="isDefault"
                  defaultChecked={current?.isDefault ?? providers.length === 0}
                />
              }
              label={t('Providers.makeDefault')}
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
        title={t('Providers.deleteTitle')}
        body={t('Providers.deleteBody')}
        confirmLabel={t('Common.delete')}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          void run(() => deleteProviderAction(tenantSlug, { id: deleting.id }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => setDeleting(null),
          })
        }
      />
    </>
  );
}
