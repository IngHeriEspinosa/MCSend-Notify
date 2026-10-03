'use client';

/**
 * Webhooks salientes: destinos, eventos suscritos, secreto de firma (se muestra una sola vez),
 * envío de prueba, rotación del secreto y registro de las últimas entregas.
 */
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
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  createWebhookAction,
  deleteWebhookAction,
  listWebhookDeliveriesAction,
  rotateWebhookSecretAction,
  sendWebhookTestAction,
  updateWebhookAction,
} from '@/app/_server/actions/webhooks.actions';
import { useAction } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { CopyField } from '@/components/molecules/CopyField';
import { EmptyState } from '@/components/molecules/EmptyState';
import {
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookDeliveryStatus,
  type WebhookDeliveryView,
  type WebhookEndpointView,
  type WebhookEventType,
} from '@/core/webhooks/webhook';

type Editing = { mode: 'create' } | { mode: 'edit'; endpoint: WebhookEndpointView } | null;

/** Claves de mensaje por tipo de evento (next-intl no admite `.` en las claves). */
const EVENT_LABELS = {
  'campaign.sent': 'campaignSent',
  'campaign.approval_requested': 'campaignApprovalRequested',
  'delivery.bounced': 'deliveryBounced',
  'delivery.complained': 'deliveryComplained',
  'contact.unsubscribed': 'contactUnsubscribed',
  'automation.run_failed': 'automationRunFailed',
} as const satisfies Record<WebhookEventType, string>;

const DELIVERY_TONES: Record<WebhookDeliveryStatus, 'warning' | 'success' | 'error'> = {
  PENDING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'error',
};

export function WebhooksManager({
  tenantSlug,
  endpoints,
  timeZone,
}: {
  tenantSlug: string;
  endpoints: WebhookEndpointView[];
  timeZone: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { run, pending, fieldErrors } = useAction();
  const [editing, setEditing] = useState<Editing>(null);
  const [events, setEvents] = useState<WebhookEventType[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpointView | null>(null);
  const [rotating, setRotating] = useState<WebhookEndpointView | null>(null);
  const [log, setLog] = useState<{
    endpoint: WebhookEndpointView;
    deliveries: WebhookDeliveryView[];
  } | null>(null);
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  });
  const formatDate = (date: Date | null) =>
    date ? dateTime.format(new Date(date)) : t('Common.never');

  const openEditor = (next: Editing) => {
    setEditing(next);
    setSecret(null);
    setEvents(next?.mode === 'edit' ? next.endpoint.events : ['campaign.sent']);
    setEnabled(next?.mode === 'edit' ? next.endpoint.enabled : true);
  };

  const closeEditor = () => {
    setEditing(null);
    setSecret(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const input = {
      url: String(form.get('url') ?? '').trim(),
      description: String(form.get('description') ?? ''),
      events,
      enabled,
    };
    if (editing.mode === 'create') {
      void run(() => createWebhookAction(tenantSlug, input), {
        onSuccess: (data) => setSecret(data.secret),
      });
    } else {
      void run(
        () => updateWebhookAction(tenantSlug, { id: editing.endpoint.id, endpoint: input }),
        {
          successMessage: t('Common.saved'),
          onSuccess: closeEditor,
        },
      );
    }
  };

  const showLog = (endpoint: WebhookEndpointView) =>
    void run(() => listWebhookDeliveriesAction(tenantSlug, { id: endpoint.id }), {
      onSuccess: (deliveries) => setLog({ endpoint, deliveries }),
    });

  const toggleEvent = (type: WebhookEventType, checked: boolean) =>
    setEvents((current) =>
      checked ? [...current, type] : current.filter((item) => item !== type),
    );

  return (
    <div className="flex flex-col gap-4">
      <Alert severity="info">
        {t('Webhooks.signatureHelp', { header: WEBHOOK_SIGNATURE_HEADER })}
      </Alert>
      <div className="flex justify-end">
        <Button variant="contained" onClick={() => openEditor({ mode: 'create' })}>
          {t('Webhooks.new')}
        </Button>
      </div>

      {endpoints.length === 0 ? (
        <EmptyState message={t('Webhooks.empty')} />
      ) : (
        <TableContainer className="rounded-lg border border-line">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('Webhooks.url')}</TableCell>
                <TableCell>{t('Webhooks.events')}</TableCell>
                <TableCell>{t('Webhooks.status')}</TableCell>
                <TableCell>{t('Webhooks.lastDelivery')}</TableCell>
                <TableCell align="right">{t('Common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {endpoints.map((endpoint) => (
                <TableRow key={endpoint.id}>
                  <TableCell>
                    <div className="max-w-xs font-mono text-sm break-all">{endpoint.url}</div>
                    {endpoint.description ? (
                      <div className="text-sm text-ink-muted">{endpoint.description}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {endpoint.events.map((type) => (
                        <StatusChip
                          key={type}
                          label={t(`Webhooks.eventNames.${EVENT_LABELS[type]}`)}
                        />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      label={endpoint.enabled ? t('Webhooks.enabled') : t('Webhooks.disabled')}
                      tone={endpoint.enabled ? 'success' : 'default'}
                    />
                    {endpoint.failureCount > 0 ? (
                      <div className="mt-1 text-sm text-ink-muted">
                        {t('Webhooks.failures', { count: endpoint.failureCount })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div>{formatDate(endpoint.lastDeliveryAt)}</div>
                    {endpoint.lastError ? (
                      <div className="text-sm text-ink-muted">{endpoint.lastError}</div>
                    ) : endpoint.lastStatus ? (
                      <div className="text-sm text-ink-muted">HTTP {endpoint.lastStatus}</div>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        size="small"
                        disabled={pending || !endpoint.enabled}
                        onClick={() =>
                          void run(() => sendWebhookTestAction(tenantSlug, { id: endpoint.id }), {
                            successMessage: t('Webhooks.testQueued'),
                          })
                        }
                      >
                        {t('Webhooks.test')}
                      </Button>
                      <Button size="small" disabled={pending} onClick={() => showLog(endpoint)}>
                        {t('Webhooks.deliveries')}
                      </Button>
                      <Button size="small" onClick={() => openEditor({ mode: 'edit', endpoint })}>
                        {t('Common.edit')}
                      </Button>
                      <Button size="small" onClick={() => setRotating(endpoint)}>
                        {t('Webhooks.rotate')}
                      </Button>
                      <Button size="small" color="error" onClick={() => setDeleting(endpoint)}>
                        {t('Common.delete')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={editing !== null} onClose={closeEditor} fullWidth maxWidth="sm">
        {secret ? (
          <>
            <DialogTitle>{t('Webhooks.secretTitle')}</DialogTitle>
            <DialogContent className="flex flex-col gap-4">
              <Alert severity="warning">{t('Webhooks.secretBody')}</Alert>
              <CopyField label={t('Webhooks.secret')} value={secret} />
            </DialogContent>
            <DialogActions>
              <Button onClick={closeEditor}>{t('Common.close')}</Button>
            </DialogActions>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <DialogTitle>
              {editing?.mode === 'edit' ? t('Webhooks.editTitle') : t('Webhooks.new')}
            </DialogTitle>
            <DialogContent className="flex flex-col gap-4 pt-2">
              <TextField
                name="url"
                type="url"
                label={t('Webhooks.url')}
                defaultValue={editing?.mode === 'edit' ? editing.endpoint.url : ''}
                placeholder="https://"
                required
                autoFocus
                fullWidth
                margin="dense"
                error={Boolean(fieldErrors.url)}
                helperText={t('Webhooks.urlHint')}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
              <TextField
                name="description"
                label={t('Common.description')}
                defaultValue={editing?.mode === 'edit' ? (editing.endpoint.description ?? '') : ''}
                fullWidth
                error={Boolean(fieldErrors.description)}
                slotProps={{ htmlInput: { maxLength: 200 } }}
              />
              <FormControl component="fieldset" error={Boolean(fieldErrors.events)}>
                <FormLabel component="legend">{t('Webhooks.events')}</FormLabel>
                <FormGroup>
                  {WEBHOOK_EVENT_TYPES.map((type) => (
                    <FormControlLabel
                      key={type}
                      label={
                        <span>
                          {t(`Webhooks.eventNames.${EVENT_LABELS[type]}`)}{' '}
                          <code className="text-sm text-ink-muted">{type}</code>
                        </span>
                      }
                      control={
                        <Checkbox
                          checked={events.includes(type)}
                          onChange={(event) => toggleEvent(type, event.target.checked)}
                        />
                      }
                    />
                  ))}
                </FormGroup>
                {fieldErrors.events ? (
                  <FormHelperText>{t('Webhooks.eventsRequired')}</FormHelperText>
                ) : null}
              </FormControl>
              {editing?.mode === 'edit' ? (
                <FormControlLabel
                  control={
                    <Switch
                      checked={enabled}
                      onChange={(event) => setEnabled(event.target.checked)}
                    />
                  }
                  label={t('Webhooks.enabled')}
                />
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button onClick={closeEditor}>{t('Common.cancel')}</Button>
              <Button type="submit" variant="contained" disabled={pending || events.length === 0}>
                {editing?.mode === 'edit' ? t('Common.save') : t('Common.create')}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      <Dialog open={log !== null} onClose={() => setLog(null)} fullWidth maxWidth="md">
        <DialogTitle>{t('Webhooks.deliveriesTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" className="mb-3 font-mono break-all">
            {log?.endpoint.url}
          </Typography>
          {log && log.deliveries.length === 0 ? (
            <EmptyState message={t('Webhooks.noDeliveries')} />
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('Common.createdAt')}</TableCell>
                    <TableCell>{t('Webhooks.event')}</TableCell>
                    <TableCell>{t('Webhooks.status')}</TableCell>
                    <TableCell align="right">{t('Webhooks.attempts')}</TableCell>
                    <TableCell>{t('Webhooks.response')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {log?.deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell>{formatDate(delivery.createdAt)}</TableCell>
                      <TableCell>
                        <code className="text-sm">{delivery.eventType}</code>
                      </TableCell>
                      <TableCell>
                        <StatusChip
                          label={t(`Webhooks.deliveryStatuses.${delivery.status}`)}
                          tone={DELIVERY_TONES[delivery.status]}
                        />
                      </TableCell>
                      <TableCell align="right">{delivery.attempts}</TableCell>
                      <TableCell>
                        {delivery.error ??
                          (delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : '—')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLog(null)}>{t('Common.close')}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={rotating !== null}
        title={t('Webhooks.rotateTitle')}
        body={t('Webhooks.rotateBody')}
        confirmLabel={t('Webhooks.rotate')}
        pending={pending}
        onClose={() => setRotating(null)}
        onConfirm={() =>
          rotating &&
          void run(() => rotateWebhookSecretAction(tenantSlug, { id: rotating.id }), {
            onSuccess: (data) => {
              setRotating(null);
              setEditing({ mode: 'edit', endpoint: rotating });
              setSecret(data.secret);
            },
          })
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t('Webhooks.deleteTitle')}
        body={t('Webhooks.deleteBody')}
        confirmLabel={t('Common.delete')}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          void run(() => deleteWebhookAction(tenantSlug, { id: deleting.id }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => setDeleting(null),
          })
        }
      />
    </div>
  );
}
