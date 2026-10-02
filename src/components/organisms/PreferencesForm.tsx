'use client';

/**
 * Centro de preferencias del destinatario (página pública con token firmado): elegir los temas
 * que quiere recibir o darse de baja de todo. Con `intent=unsubscribe` (enlace del pie) se
 * ofrece primero la baja con confirmación explícita.
 */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { updatePreferencesAction } from '@/app/_server/actions/public.actions';

interface PreferencesFormProps {
  token: string;
  tenantName: string;
  email: string;
  unsubscribedAll: boolean;
  intentUnsubscribe: boolean;
  topics: Array<{ id: string; name: { es: string; en: string }; subscribed: boolean }>;
}

export function PreferencesForm({
  token,
  tenantName,
  email,
  unsubscribedAll,
  intentUnsubscribe,
  topics,
}: PreferencesFormProps) {
  const t = useTranslations('Preferences');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [selection, setSelection] = useState(() =>
    Object.fromEntries(topics.map((topic) => [topic.id, topic.subscribed])),
  );
  const [state, setState] = useState<'idle' | 'saved' | 'unsubscribed' | 'error'>(
    unsubscribedAll ? 'unsubscribed' : 'idle',
  );

  const save = (unsubscribeAll: boolean) =>
    startTransition(async () => {
      const result = await updatePreferencesAction(token, { unsubscribeAll, topics: selection });
      setState(result.ok ? (unsubscribeAll ? 'unsubscribed' : 'saved') : 'error');
    });

  return (
    <Card variant="outlined">
      <CardContent className="flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-col gap-1">
          <Typography variant="h5" component="h1">
            {t('title', { tenant: tenantName })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('subtitle', { email })}
          </Typography>
        </div>

        {state === 'unsubscribed' ? (
          <Alert severity="success" role="status">
            {t('unsubscribedAll', { tenant: tenantName })}
          </Alert>
        ) : null}
        {state === 'saved' ? (
          <Alert severity="success" role="status">
            {t('saved')}
          </Alert>
        ) : null}
        {state === 'error' ? <Alert severity="error">{t('error')}</Alert> : null}

        {state !== 'unsubscribed' && intentUnsubscribe ? (
          <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
            <Typography>{t('confirmUnsubscribe', { tenant: tenantName })}</Typography>
            <Button variant="contained" color="error" disabled={pending} onClick={() => save(true)}>
              {t('unsubscribeAll')}
            </Button>
          </div>
        ) : null}

        {state !== 'unsubscribed' && topics.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 font-semibold">{t('topicsLegend')}</legend>
            <FormGroup>
              {topics.map((topic) => (
                <FormControlLabel
                  key={topic.id}
                  control={
                    <Checkbox
                      checked={selection[topic.id] ?? false}
                      onChange={(event) =>
                        setSelection((current) => ({
                          ...current,
                          [topic.id]: event.target.checked,
                        }))
                      }
                    />
                  }
                  label={locale === 'en' ? topic.name.en : topic.name.es}
                />
              ))}
            </FormGroup>
            <Button variant="outlined" disabled={pending} onClick={() => save(false)}>
              {t('savePreferences')}
            </Button>
          </fieldset>
        ) : null}

        {state !== 'unsubscribed' && !intentUnsubscribe ? (
          <Button color="error" disabled={pending} onClick={() => save(true)}>
            {t('unsubscribeAll')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
