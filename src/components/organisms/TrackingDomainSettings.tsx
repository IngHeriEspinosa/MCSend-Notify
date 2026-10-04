'use client';

/**
 * Dominio de seguimiento propio: alta, instrucciones del CNAME, verificación y baja. Mientras no
 * esté verificado, los correos usan el dominio de la plataforma.
 */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  removeTrackingDomainAction,
  setTrackingDomainAction,
  verifyTrackingDomainAction,
} from '@/app/_server/actions/tracking-domain.actions';
import { useAction } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import type { TrackingDomainView } from '@/core/tenants/tracking-domain';

export function TrackingDomainSettings({
  tenantSlug,
  initial,
  platformHost,
  canUpdate,
  timeZone,
}: {
  tenantSlug: string;
  initial: TrackingDomainView | null;
  platformHost: string;
  canUpdate: boolean;
  timeZone: string;
}) {
  const t = useTranslations('TrackingDomain');
  const locale = useLocale();
  const { run, pending, fieldErrors } = useAction();
  const [view, setView] = useState(initial);
  const [domain, setDomain] = useState('');
  const [removing, setRemoving] = useState(false);
  const dateTime = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(() => setTrackingDomainAction(tenantSlug, { domain }), {
      onSuccess: (next) => {
        setView(next);
        setDomain('');
      },
    });
  };

  return (
    <Card variant="outlined" component="section" aria-labelledby="tracking-domain-title">
      <CardContent className="flex flex-col gap-4">
        <div>
          <Typography id="tracking-domain-title" variant="h6" component="h2">
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle')}
          </Typography>
        </div>

        {view ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <code className="text-base font-semibold">{view.domain}</code>
              <StatusChip
                label={view.verifiedAt ? t('verified') : t('pending')}
                tone={view.verifiedAt ? 'success' : 'warning'}
              />
              {view.checkedAt ? (
                <Typography variant="body2" color="text.secondary">
                  {t('checkedAt', { date: dateTime.format(new Date(view.checkedAt)) })}
                </Typography>
              ) : null}
            </div>
            {view.verifiedAt ? (
              <Alert severity="success">{t('inUse')}</Alert>
            ) : (
              <Alert severity="warning">
                {view.error ? t(`errors.${view.error}`) : t('notChecked')}
              </Alert>
            )}
            <div className="rounded-lg border border-line p-3">
              <Typography variant="body2" className="mb-2">
                {t('instructions')}
              </Typography>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t('instructions')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('recordName')}</th>
                    <th scope="col">{t('recordType')}</th>
                    <th scope="col">{t('recordValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="font-mono break-all">{view.domain}</td>
                    <td className="font-mono">CNAME</td>
                    <td className="font-mono break-all">{view.cnameTarget}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {canUpdate ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="contained"
                  disabled={pending}
                  onClick={() =>
                    void run(() => verifyTrackingDomainAction(tenantSlug, {}), {
                      onSuccess: setView,
                    })
                  }
                >
                  {t('verify')}
                </Button>
                <Button color="error" disabled={pending} onClick={() => setRemoving(true)}>
                  {t('remove')}
                </Button>
              </div>
            ) : null}
          </>
        ) : canUpdate ? (
          <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
            <TextField
              label={t('domain')}
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="clic.ejemplo.com"
              helperText={t('domainHint', { target: platformHost })}
              error={Boolean(fieldErrors.domain)}
              required
              slotProps={{ htmlInput: { maxLength: 253, spellCheck: false } }}
            />
            <div>
              <Button type="submit" variant="contained" disabled={pending || domain.trim() === ''}>
                {t('save')}
              </Button>
            </div>
          </form>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('none')}
          </Typography>
        )}
      </CardContent>

      <ConfirmDialog
        open={removing}
        title={t('removeTitle')}
        body={t('removeBody')}
        confirmLabel={t('remove')}
        pending={pending}
        onClose={() => setRemoving(false)}
        onConfirm={() =>
          void run(() => removeTrackingDomainAction(tenantSlug, {}), {
            onSuccess: () => {
              setRemoving(false);
              setView(null);
            },
          })
        }
      />
    </Card>
  );
}
