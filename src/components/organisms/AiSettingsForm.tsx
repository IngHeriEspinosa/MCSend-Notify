'use client';

/**
 * Configuración de IA del tenant: IA de la plataforma o clave propia (Anthropic, OpenAI o una API
 * compatible como Ollama), modelos, presupuesto mensual, prueba de conexión y uso del mes.
 * La clave nunca vuelve al navegador: el campo queda vacío y "vacío" conserva la guardada.
 */
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  disableAiAction,
  saveAiSettingsAction,
  verifyAiSettingsAction,
} from '@/app/_server/actions/ai.actions';
import { useNotify } from '@/common/hooks/notifications';
import { useAction, useActionErrorMessage } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import {
  AI_PROVIDER_KINDS,
  AI_PURPOSES,
  ANTHROPIC_MODELS,
  DEFAULT_AI_MODEL,
  type AiProviderKind,
  type AiSettingsInput,
  type AiSettingsView,
  type AiSource,
} from '@/core/ai/ai';
import type { AiUsageSummary } from '@/core/ai/ports';

const NONE = 'none';

interface AiSettingsFormProps {
  tenantSlug: string;
  settings: AiSettingsView | null;
  platformAvailable: boolean;
  platformMaxBudgetUsd: number;
  budgetMicros: number;
  usage: AiUsageSummary;
  timeZone: string;
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

function optionalNumber(form: FormData, name: string): number | null {
  const value = text(form, name);
  return value === '' ? null : Number(value);
}

export function AiSettingsForm({
  tenantSlug,
  settings,
  platformAvailable,
  platformMaxBudgetUsd,
  budgetMicros,
  usage,
  timeZone,
}: AiSettingsFormProps) {
  const t = useTranslations();
  const locale = useLocale();
  const notify = useNotify();
  const errorMessage = useActionErrorMessage();
  const { run, pending, fieldErrors } = useAction();
  const [source, setSource] = useState<AiSource>(
    settings?.source ?? (platformAvailable ? 'PLATFORM' : 'OWN'),
  );
  const [kind, setKind] = useState<AiProviderKind>(settings?.kind ?? 'ANTHROPIC');
  const [disabling, setDisabling] = useState(false);
  const usd = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
  const ownAnthropic = source === 'OWN' && kind === 'ANTHROPIC';
  const keepKey = settings?.source === 'OWN' && settings.kind === kind && settings.hasApiKey;
  const spent = usage.costMicros / 1_000_000;
  const budget = budgetMicros / 1_000_000;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fast = text(form, 'fastModel');
    const common = {
      fastModel: fast === '' || fast === NONE ? null : fast,
      monthlyBudgetUsd: Number(text(form, 'monthlyBudgetUsd')) || 0,
    };
    const input: AiSettingsInput =
      source === 'PLATFORM'
        ? {
            source: 'PLATFORM',
            defaultModel:
              ANTHROPIC_MODELS.find((model) => model === text(form, 'defaultModel')) ??
              DEFAULT_AI_MODEL,
            fastModel: ANTHROPIC_MODELS.find((model) => model === common.fastModel) ?? null,
            monthlyBudgetUsd: common.monthlyBudgetUsd,
          }
        : {
            source: 'OWN',
            kind,
            apiKey: text(form, 'apiKey') === '' && keepKey ? null : text(form, 'apiKey'),
            baseUrl: text(form, 'baseUrl') === '' ? null : text(form, 'baseUrl'),
            defaultModel: text(form, 'defaultModel'),
            ...common,
            inputPricePerMTok: optionalNumber(form, 'inputPricePerMTok'),
            outputPricePerMTok: optionalNumber(form, 'outputPricePerMTok'),
          };
    void run(() => saveAiSettingsAction(tenantSlug, input), {
      successMessage: t('AiSettings.saved'),
    });
  };

  const verify = () =>
    void run(() => verifyAiSettingsAction(tenantSlug, {}), {
      onSuccess: (result) =>
        result.ok
          ? notify(t('AiSettings.verifyOk'), 'success')
          : notify(
              errorMessage({ code: 'INVALID_STATE', details: { reason: result.reason } }),
              'error',
            ),
    });

  const modelSelect = (name: string, label: string, value: string | null, optional: boolean) => (
    <TextField
      select
      name={name}
      label={label}
      defaultValue={value ?? (optional ? NONE : DEFAULT_AI_MODEL)}
      fullWidth
    >
      {optional ? <MenuItem value={NONE}>{t('AiSettings.noFastModel')}</MenuItem> : null}
      {ANTHROPIC_MODELS.map((model) => (
        <MenuItem key={model} value={model}>
          {t(`AiSettings.models.${model}`)}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card variant="outlined">
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {settings ? (
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip
                  label={t(`Providers.statuses.${settings.status}`)}
                  tone={settings.status === 'ACTIVE' ? 'success' : 'error'}
                />
                <Typography variant="body2" color="text.secondary">
                  {settings.lastVerifiedAt
                    ? t('Providers.verifiedAt', {
                        date: dateFormat.format(settings.lastVerifiedAt),
                      })
                    : t('Providers.neverVerified')}
                </Typography>
              </div>
            ) : (
              <Alert severity="info">{t('AiSettings.disabledHint')}</Alert>
            )}
            {settings?.lastError ? <Alert severity="error">{settings.lastError}</Alert> : null}

            <div className="flex flex-col gap-1">
              <FormLabel id="ai-source-label">{t('AiSettings.source')}</FormLabel>
              <RadioGroup
                aria-labelledby="ai-source-label"
                value={source}
                onChange={(event) => setSource(event.target.value === 'OWN' ? 'OWN' : 'PLATFORM')}
              >
                <FormControlLabel
                  value="PLATFORM"
                  control={<Radio />}
                  disabled={!platformAvailable}
                  label={
                    <span className="flex flex-col py-1">
                      <span className="font-medium">{t('AiSettings.sources.PLATFORM')}</span>
                      <Typography variant="body2" color="text.secondary" component="span">
                        {platformAvailable
                          ? t('AiSettings.platformHint', { max: usd.format(platformMaxBudgetUsd) })
                          : t('AiSettings.platformUnavailable')}
                      </Typography>
                    </span>
                  }
                />
                <FormControlLabel
                  value="OWN"
                  control={<Radio />}
                  label={
                    <span className="flex flex-col py-1">
                      <span className="font-medium">{t('AiSettings.sources.OWN')}</span>
                      <Typography variant="body2" color="text.secondary" component="span">
                        {t('AiSettings.ownHint')}
                      </Typography>
                    </span>
                  }
                />
              </RadioGroup>
            </div>

            {source === 'OWN' ? (
              <>
                <TextField
                  select
                  label={t('AiSettings.kind')}
                  value={kind}
                  onChange={(event) =>
                    setKind(
                      AI_PROVIDER_KINDS.find((item) => item === event.target.value) ?? 'ANTHROPIC',
                    )
                  }
                  helperText={t(`AiSettings.kindHints.${kind}`)}
                >
                  {AI_PROVIDER_KINDS.map((item) => (
                    <MenuItem key={item} value={item}>
                      {t(`AiSettings.kinds.${item}`)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  name="apiKey"
                  type="password"
                  label={t('AiSettings.apiKey')}
                  autoComplete="off"
                  required={!keepKey && kind !== 'OPENAI_COMPATIBLE'}
                  helperText={keepKey ? t('Providers.keepSecret') : t('AiSettings.apiKeyHint')}
                  error={Boolean(fieldErrors.apiKey)}
                />
                {kind !== 'ANTHROPIC' ? (
                  <TextField
                    name="baseUrl"
                    type="url"
                    label={t('AiSettings.baseUrl')}
                    defaultValue={settings?.baseUrl ?? ''}
                    required={kind === 'OPENAI_COMPATIBLE'}
                    helperText={t(`AiSettings.baseUrlHints.${kind}`)}
                    error={Boolean(fieldErrors.baseUrl)}
                  />
                ) : null}
              </>
            ) : null}

            <div key={`${source}-${kind}`} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {source === 'PLATFORM' || ownAnthropic ? (
                <>
                  {modelSelect(
                    'defaultModel',
                    t('AiSettings.defaultModel'),
                    settings?.defaultModel ?? null,
                    false,
                  )}
                  {modelSelect(
                    'fastModel',
                    t('AiSettings.fastModel'),
                    settings?.fastModel ?? null,
                    true,
                  )}
                </>
              ) : (
                <>
                  <TextField
                    name="defaultModel"
                    label={t('AiSettings.defaultModel')}
                    defaultValue={settings?.kind === kind ? settings.defaultModel : ''}
                    required
                    helperText={t('AiSettings.modelHint')}
                    error={Boolean(fieldErrors.defaultModel)}
                  />
                  <TextField
                    name="fastModel"
                    label={t('AiSettings.fastModel')}
                    defaultValue={settings?.kind === kind ? (settings.fastModel ?? '') : ''}
                    helperText={t('AiSettings.fastModelHint')}
                  />
                </>
              )}
            </div>

            <TextField
              name="monthlyBudgetUsd"
              type="number"
              label={t('AiSettings.budget')}
              defaultValue={settings?.monthlyBudgetUsd ?? Math.min(20, platformMaxBudgetUsd)}
              required
              helperText={
                source === 'PLATFORM'
                  ? t('AiSettings.budgetPlatformHint', { max: usd.format(platformMaxBudgetUsd) })
                  : t('AiSettings.budgetHint')
              }
              error={Boolean(fieldErrors.monthlyBudgetUsd)}
              slotProps={{ htmlInput: { min: 0, step: 1 } }}
            />

            {source === 'OWN' && kind !== 'ANTHROPIC' ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  name="inputPricePerMTok"
                  type="number"
                  label={t('AiSettings.inputPrice')}
                  defaultValue={settings?.inputPricePerMTok ?? ''}
                  slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                />
                <TextField
                  name="outputPricePerMTok"
                  type="number"
                  label={t('AiSettings.outputPrice')}
                  defaultValue={settings?.outputPricePerMTok ?? ''}
                  helperText={t('AiSettings.priceHint')}
                  slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
                />
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="contained" disabled={pending}>
                {pending ? t('Common.saving') : t('Common.save')}
              </Button>
              {settings ? (
                <>
                  <Button variant="outlined" onClick={verify} disabled={pending}>
                    {t('Providers.verify')}
                  </Button>
                  <Button color="error" onClick={() => setDisabling(true)} disabled={pending}>
                    {t('AiSettings.disable')}
                  </Button>
                </>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined" component="section" aria-labelledby="ai-usage-title">
        <CardContent className="flex flex-col gap-4">
          <Typography id="ai-usage-title" variant="h6" component="h2">
            {t('AiSettings.usageTitle')}
          </Typography>
          <div className="flex flex-col gap-1">
            <Typography>
              {t('AiSettings.spent', { spent: usd.format(spent), budget: usd.format(budget) })}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={budget > 0 ? Math.min(100, (spent / budget) * 100) : 0}
              color={budget > 0 && spent >= budget ? 'error' : 'primary'}
              aria-label={t('AiSettings.budgetProgress')}
            />
            <Typography variant="body2" color="text.secondary">
              {t('AiSettings.calls', { calls: usage.calls, errors: usage.errors })}
            </Typography>
          </div>
          {usage.byPurpose.length > 0 ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('AiSettings.purpose')}</TableCell>
                  <TableCell align="right">{t('AiSettings.callsColumn')}</TableCell>
                  <TableCell align="right">{t('AiSettings.costColumn')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {usage.byPurpose.map((row) => {
                  const purpose = AI_PURPOSES.find((item) => item === row.purpose);
                  return (
                    <TableRow key={row.purpose}>
                      <TableCell>
                        {purpose ? t(`AiSettings.purposes.${purpose}`) : row.purpose}
                      </TableCell>
                      <TableCell align="right">{row.calls}</TableCell>
                      <TableCell align="right">{usd.format(row.costMicros / 1_000_000)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('AiSettings.noUsage')}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {t('AiSettings.privacy')}
          </Typography>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={disabling}
        title={t('AiSettings.disableTitle')}
        body={t('AiSettings.disableBody')}
        confirmLabel={t('AiSettings.disable')}
        pending={pending}
        onClose={() => setDisabling(false)}
        onConfirm={() =>
          void run(() => disableAiAction(tenantSlug, {}), {
            successMessage: t('AiSettings.disabled'),
            onSuccess: () => setDisabling(false),
          })
        }
      />
    </div>
  );
}
