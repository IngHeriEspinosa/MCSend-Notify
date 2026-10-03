'use client';

/**
 * Asistente de campaña (borrador): contenido, audiencia con recuento en vivo, remitente y
 * opciones (A/B, seguimiento, ritmo), revisión con comprobaciones, vista previa y envío de prueba,
 * y programación con confirmación del número de destinatarios en envíos grandes.
 */
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import DesktopWindowsOutlined from '@mui/icons-material/DesktopWindowsOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import PhoneIphoneOutlined from '@mui/icons-material/PhoneIphoneOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Step from '@mui/material/Step';
import StepButton from '@mui/material/StepButton';
import Stepper from '@mui/material/Stepper';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  campaignChecksAction,
  campaignPreviewAction,
  countAudienceAction,
  scheduleCampaignAction,
  sendTestAction,
  updateCampaignAction,
} from '@/app/_server/actions/campaigns.actions';
import { useNotify } from '@/common/hooks/notifications';
import { useAction } from '@/common/hooks/use-action';
import { Link } from '@/common/i18n/navigation';
import { EmailPreviewFrame } from '@/components/molecules/EmailPreviewFrame';
import { AiDraftDialog } from './AiDraftDialog';
import type { CampaignAudience, CampaignIssue } from '@/core/campaigns/campaign';

type Option = { id: string; label: string };

interface CampaignEditorProps {
  tenantSlug: string;
  campaign: {
    id: string;
    name: string;
    version: number;
    templateId: string | null;
    audience: CampaignAudience;
    topicId: string | null;
    senderIdentityId: string | null;
    subjectB: string | null;
    trackOpens: boolean;
    trackClicks: boolean;
    throttlePerHour: number | null;
  };
  templates: Option[];
  lists: Option[];
  segments: Option[];
  topics: Option[];
  senders: Array<Option & { dnsOk: boolean }>;
  contacts: Option[];
  confirmationThreshold: number;
  canSend: boolean;
  ai: { enabled: boolean; documents: Array<{ id: string; title: string }> };
  defaultLocale: 'es' | 'en';
}

const NONE = 'none';
const SAMPLE = 'sample';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" component="section" className="flex flex-col gap-4 p-4">
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <Autocomplete
      multiple
      options={options}
      value={options.filter((option) => value.includes(option.id))}
      onChange={(_event, selected) => onChange(selected.map((option) => option.id))}
      getOptionLabel={(option) => option.label}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}

export function CampaignEditor({
  tenantSlug,
  campaign,
  templates,
  lists,
  segments,
  topics,
  senders,
  contacts,
  confirmationThreshold,
  canSend,
  ai,
  defaultLocale,
}: CampaignEditorProps) {
  const t = useTranslations();
  const locale = useLocale();
  const notify = useNotify();
  const { run, pending } = useAction();
  const [step, setStep] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [version, setVersion] = useState(campaign.version);
  const [draft, setDraft] = useState({
    name: campaign.name,
    templateId: campaign.templateId ?? templates[0]?.id ?? '',
    audience: campaign.audience,
    topicId: campaign.topicId ?? NONE,
    senderIdentityId: campaign.senderIdentityId ?? senders[0]?.id ?? '',
    subjectB: campaign.subjectB ?? '',
    trackOpens: campaign.trackOpens,
    trackClicks: campaign.trackClicks,
    throttlePerHour: campaign.throttlePerHour ? String(campaign.throttlePerHour) : '',
  });
  const [saved, setSaved] = useState(() => JSON.stringify(draft));
  const [recipients, setRecipients] = useState<number | null>(null);
  const [checks, setChecks] = useState<{ issues: CampaignIssue[]; recipients: number } | null>(
    null,
  );
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [dark, setDark] = useState(false);
  const [variant, setVariant] = useState<'A' | 'B'>('A');
  const [previewContact, setPreviewContact] = useState(SAMPLE);
  const [testEmails, setTestEmails] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const countRequest = useRef(0);
  const dirty = JSON.stringify(draft) !== saved;
  const topicId = draft.topicId === NONE ? null : draft.topicId;
  const audienceKey = useMemo(
    () => JSON.stringify({ audience: draft.audience, topicId }),
    [draft.audience, topicId],
  );

  useEffect(() => {
    const current = ++countRequest.current;
    const timer = setTimeout(async () => {
      const result = await countAudienceAction(
        tenantSlug,
        JSON.parse(audienceKey) as { audience: CampaignAudience; topicId: string | null },
      );
      if (current === countRequest.current && result.ok) setRecipients(result.data);
    }, 400);
    return () => clearTimeout(timer);
  }, [audienceKey, tenantSlug]);

  const payload = () => ({
    campaignId: campaign.id,
    expectedVersion: version,
    name: draft.name,
    templateId: draft.templateId,
    audience: draft.audience,
    topicId,
    senderIdentityId: draft.senderIdentityId || null,
    subjectB: draft.subjectB,
    trackOpens: draft.trackOpens,
    trackClicks: draft.trackClicks,
    throttlePerHour: draft.throttlePerHour ? Number(draft.throttlePerHour) : null,
  });

  /** Guarda si hay cambios; devuelve false si la validación falló. */
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    const result = await run(() => updateCampaignAction(tenantSlug, payload()), {
      successMessage: t('Common.saved'),
    });
    if (result.ok) {
      setVersion(result.data.version);
      setSaved(JSON.stringify(draft));
    }
    return result.ok;
  };

  const goTo = async (next: number) => {
    if (!(await save())) return;
    setStep(next);
  };

  // Comprobaciones y vista previa en los pasos de revisión y programación.
  useEffect(() => {
    if (step < 3) return;
    let cancelled = false;
    void (async () => {
      const [checkResult, previewResult] = await Promise.all([
        campaignChecksAction(tenantSlug, { campaignId: campaign.id }),
        campaignPreviewAction(tenantSlug, {
          campaignId: campaign.id,
          contactId: previewContact === SAMPLE ? null : previewContact,
          colorScheme: dark ? 'dark' : 'light',
          variant,
        }),
      ]);
      if (cancelled) return;
      if (checkResult.ok) setChecks(checkResult.data);
      if (previewResult.ok) setPreview(previewResult.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [step, version, dark, variant, previewContact, campaign.id, tenantSlug]);

  const sendTest = () => {
    const emails = testEmails.split(/[\s,;]+/).filter(Boolean);
    void run(() => sendTestAction(tenantSlug, { campaignId: campaign.id, emails }), {
      onSuccess: (results) => {
        const failed = results.filter((item) => !item.ok);
        notify(
          failed.length === 0
            ? t('CampaignEditor.testSent', { count: results.length })
            : t('CampaignEditor.testFailed', { message: failed[0]?.error ?? '' }),
          failed.length === 0 ? 'success' : 'error',
        );
      },
    });
  };

  const schedule = (confirmRecipients: number | null) =>
    void run(
      () =>
        scheduleCampaignAction(tenantSlug, {
          campaignId: campaign.id,
          expectedVersion: version,
          scheduledAt: when === 'later' && scheduledAt ? new Date(scheduledAt) : null,
          confirmRecipients,
        }),
      {
        successMessage:
          when === 'later' ? t('CampaignEditor.scheduled') : t('CampaignEditor.sending'),
        onSuccess: () => setConfirming(false),
      },
    );

  const launch = () => {
    const total = checks?.recipients ?? recipients ?? 0;
    if (total >= confirmationThreshold) {
      setTyped('');
      setConfirming(true);
    } else {
      schedule(null);
    }
  };

  const blocking = checks?.issues.some((issue) => issue.severity === 'error') ?? true;
  const numberFormat = new Intl.NumberFormat(locale);
  const steps = ['content', 'audience', 'sending', 'review', 'schedule'] as const;
  const update = (patch: Partial<typeof draft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const audience = (patch: Partial<CampaignAudience>) =>
    update({ audience: { ...draft.audience, ...patch } });

  return (
    <div className="flex flex-col gap-6">
      <Stepper
        nonLinear
        activeStep={step}
        alternativeLabel
        className="overflow-x-auto overflow-y-hidden px-4 py-6"
      >
        {steps.map((key, index) => (
          <Step key={key} completed={index < step}>
            <StepButton onClick={() => void goTo(index)}>
              {t(`CampaignEditor.steps.${key}`)}
            </StepButton>
          </Step>
        ))}
      </Stepper>

      {step === 0 ? (
        <Section title={t('CampaignEditor.steps.content')}>
          <TextField
            label={t('Common.name')}
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
            required
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <TextField
            select
            label={t('Campaigns.template')}
            value={draft.templateId}
            onChange={(event) => update({ templateId: event.target.value })}
          >
            {templates.map((template) => (
              <MenuItem key={template.id} value={template.id}>
                {template.label}
              </MenuItem>
            ))}
          </TextField>
          {draft.templateId ? (
            <Link
              href={`/t/${tenantSlug}/templates/${draft.templateId}`}
              className="text-sm text-primary hover:underline"
            >
              {t('CampaignEditor.editTemplate')}
            </Link>
          ) : null}
          <Typography variant="body2" color="text.secondary">
            {t('CampaignEditor.contentHint')}
          </Typography>
          {ai.enabled ? (
            <div>
              <Button startIcon={<AutoAwesomeOutlined />} onClick={() => setDrafting(true)}>
                {t('AiDraft.open')}
              </Button>
              <AiDraftDialog
                tenantSlug={tenantSlug}
                open={drafting}
                onClose={() => setDrafting(false)}
                defaultLocale={defaultLocale}
                documents={ai.documents}
                onCreated={(id) => {
                  setDrafting(false);
                  update({ templateId: id });
                }}
              />
            </div>
          ) : null}
        </Section>
      ) : null}

      {step === 1 ? (
        <Section title={t('CampaignEditor.steps.audience')}>
          <MultiSelect
            label={t('CampaignEditor.lists')}
            options={lists}
            value={draft.audience.listIds}
            onChange={(listIds) => audience({ listIds })}
          />
          <MultiSelect
            label={t('CampaignEditor.segments')}
            options={segments}
            value={draft.audience.segmentIds}
            onChange={(segmentIds) => audience({ segmentIds })}
          />
          <MultiSelect
            label={t('CampaignEditor.excludeLists')}
            options={lists}
            value={draft.audience.excludeListIds}
            onChange={(excludeListIds) => audience({ excludeListIds })}
          />
          <TextField
            select
            label={t('CampaignEditor.topic')}
            value={draft.topicId}
            onChange={(event) => update({ topicId: event.target.value })}
            helperText={t('CampaignEditor.topicHint')}
          >
            <MenuItem value={NONE}>{t('CampaignEditor.noTopic')}</MenuItem>
            {topics.map((topic) => (
              <MenuItem key={topic.id} value={topic.id}>
                {topic.label}
              </MenuItem>
            ))}
          </TextField>
          <Alert severity="info" role="status">
            {recipients === null
              ? t('Common.loading')
              : t('CampaignEditor.recipientCount', {
                  count: recipients,
                  formatted: numberFormat.format(recipients),
                })}
          </Alert>
        </Section>
      ) : null}

      {step === 2 ? (
        <Section title={t('CampaignEditor.steps.sending')}>
          {senders.length === 0 ? (
            <Alert severity="warning">
              {t('CampaignEditor.noSenders')}{' '}
              <Link href={`/t/${tenantSlug}/settings/senders`} className="font-medium underline">
                {t('Nav.senders')}
              </Link>
            </Alert>
          ) : null}
          <TextField
            select
            label={t('CampaignEditor.sender')}
            value={draft.senderIdentityId}
            onChange={(event) => update({ senderIdentityId: event.target.value })}
          >
            {senders.map((sender) => (
              <MenuItem key={sender.id} value={sender.id}>
                {sender.label}
                {sender.dnsOk ? '' : ` · ${t('CampaignEditor.dnsPending')}`}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('CampaignEditor.subjectB')}
            value={draft.subjectB}
            onChange={(event) => update({ subjectB: event.target.value })}
            helperText={t('CampaignEditor.subjectBHint')}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={draft.trackOpens}
                onChange={(event) => update({ trackOpens: event.target.checked })}
              />
            }
            label={t('CampaignEditor.trackOpens')}
          />
          <FormControlLabel
            control={
              <Switch
                checked={draft.trackClicks}
                onChange={(event) => update({ trackClicks: event.target.checked })}
              />
            }
            label={t('CampaignEditor.trackClicks')}
          />
          <TextField
            type="number"
            label={t('CampaignEditor.throttle')}
            value={draft.throttlePerHour}
            onChange={(event) => update({ throttlePerHour: event.target.value })}
            helperText={t('CampaignEditor.throttleHint')}
            slotProps={{ htmlInput: { min: 10 } }}
          />
        </Section>
      ) : null}

      {step >= 3 ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Section title={t('CampaignEditor.checks')}>
              {checks ? (
                <>
                  <Typography>
                    {t('CampaignEditor.recipientCount', {
                      count: checks.recipients,
                      formatted: numberFormat.format(checks.recipients),
                    })}
                  </Typography>
                  {checks.issues.length === 0 ? (
                    <Alert severity="success">{t('TemplateEditor.noIssues')}</Alert>
                  ) : null}
                  <ul className="flex flex-col gap-1" aria-live="polite">
                    {checks.issues.map((issue) => (
                      <li
                        key={`${issue.code}-${issue.detail ?? ''}`}
                        className="flex items-start gap-2"
                      >
                        {issue.severity === 'error' ? (
                          <ErrorOutlineOutlined
                            color="error"
                            fontSize="small"
                            aria-label={t('TemplateEditor.error')}
                          />
                        ) : (
                          <WarningAmberOutlined
                            color="warning"
                            fontSize="small"
                            aria-label={t('TemplateEditor.warning')}
                          />
                        )}
                        <Typography variant="body2">
                          {t(`CampaignIssues.${issue.code}`, { detail: issue.detail ?? '' })}
                        </Typography>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <Typography>{t('Common.loading')}</Typography>
              )}
            </Section>

            {step === 3 ? (
              <Section title={t('CampaignEditor.testTitle')}>
                <TextField
                  label={t('CampaignEditor.testEmails')}
                  value={testEmails}
                  onChange={(event) => setTestEmails(event.target.value)}
                  helperText={t('CampaignEditor.testHint')}
                />
                <Button
                  variant="outlined"
                  disabled={pending || testEmails.trim() === ''}
                  onClick={sendTest}
                >
                  {t('CampaignEditor.sendTest')}
                </Button>
              </Section>
            ) : null}

            {step === 4 ? (
              <Section title={t('CampaignEditor.steps.schedule')}>
                <RadioGroup
                  value={when}
                  onChange={(event) => setWhen(event.target.value === 'later' ? 'later' : 'now')}
                >
                  <FormControlLabel
                    value="now"
                    control={<Radio />}
                    label={t('CampaignEditor.sendNow')}
                  />
                  <FormControlLabel
                    value="later"
                    control={<Radio />}
                    label={t('CampaignEditor.sendLater')}
                  />
                </RadioGroup>
                {when === 'later' ? (
                  <TextField
                    type="datetime-local"
                    label={t('CampaignEditor.scheduledAt')}
                    value={scheduledAt}
                    onChange={(event) => setScheduledAt(event.target.value)}
                    helperText={t('CampaignEditor.localTime')}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                ) : null}
                {canSend ? (
                  <Button
                    variant="contained"
                    size="large"
                    disabled={pending || blocking || (when === 'later' && !scheduledAt)}
                    onClick={launch}
                  >
                    {when === 'later'
                      ? t('CampaignEditor.schedule')
                      : t('CampaignEditor.sendNowButton')}
                  </Button>
                ) : (
                  <Alert severity="info">{t('CampaignEditor.noSendPermission')}</Alert>
                )}
                {blocking && checks ? (
                  <Alert severity="error">{t('CampaignEditor.fixErrors')}</Alert>
                ) : null}
              </Section>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <ToggleButtonGroup
                exclusive
                size="small"
                value={device}
                aria-label={t('TemplateEditor.device')}
                onChange={(_event, next: 'desktop' | 'mobile' | null) => next && setDevice(next)}
              >
                <ToggleButton value="desktop" aria-label={t('TemplateEditor.desktop')}>
                  <DesktopWindowsOutlined fontSize="small" />
                </ToggleButton>
                <ToggleButton value="mobile" aria-label={t('TemplateEditor.mobile')}>
                  <PhoneIphoneOutlined fontSize="small" />
                </ToggleButton>
              </ToggleButtonGroup>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={dark ? 'dark' : 'light'}
                aria-label={t('TemplateEditor.scheme')}
                onChange={(_event, next: 'dark' | 'light' | null) =>
                  next && setDark(next === 'dark')
                }
              >
                <ToggleButton value="light" aria-label={t('Common.themeLight')}>
                  <LightModeOutlined fontSize="small" />
                </ToggleButton>
                <ToggleButton value="dark" aria-label={t('Common.themeDark')}>
                  <DarkModeOutlined fontSize="small" />
                </ToggleButton>
              </ToggleButtonGroup>
              {draft.subjectB ? (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={variant}
                  aria-label={t('CampaignEditor.variant')}
                  onChange={(_event, next: 'A' | 'B' | null) => next && setVariant(next)}
                >
                  <ToggleButton value="A">A</ToggleButton>
                  <ToggleButton value="B">B</ToggleButton>
                </ToggleButtonGroup>
              ) : null}
              <TextField
                select
                size="small"
                label={t('TemplateEditor.previewContact')}
                value={previewContact}
                onChange={(event) => setPreviewContact(event.target.value)}
                className="min-w-56 flex-1"
              >
                <MenuItem value={SAMPLE}>{t('TemplateEditor.sampleContact')}</MenuItem>
                {contacts.map((contact) => (
                  <MenuItem key={contact.id} value={contact.id}>
                    {contact.label}
                  </MenuItem>
                ))}
              </TextField>
            </div>
            {preview ? (
              <Typography variant="body2" className="truncate">
                <span className="font-semibold">{t('Templates.subject')}:</span> {preview.subject}
              </Typography>
            ) : null}
            <EmailPreviewFrame
              html={preview?.html ?? ''}
              device={device}
              dark={dark}
              busy={preview === null}
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-between gap-2">
        <Button disabled={step === 0} onClick={() => void goTo(step - 1)}>
          {t('Common.back')}
        </Button>
        <div className="flex gap-2">
          <Button variant="outlined" disabled={!dirty || pending} onClick={() => void save()}>
            {t('CampaignEditor.saveDraft')}
          </Button>
          {step < steps.length - 1 ? (
            <Button variant="contained" disabled={pending} onClick={() => void goTo(step + 1)}>
              {t('Common.next')}
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={confirming} onClose={() => setConfirming(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('CampaignEditor.confirmTitle')}</DialogTitle>
        <DialogContent className="flex flex-col gap-3">
          <Typography>
            {t('CampaignEditor.confirmBody', {
              formatted: numberFormat.format(checks?.recipients ?? 0),
            })}
          </Typography>
          <TextField
            label={t('CampaignEditor.confirmLabel')}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoFocus
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>{t('Common.cancel')}</Button>
          <Button
            variant="contained"
            color="warning"
            disabled={pending || Number(typed.replace(/\D/g, '')) !== (checks?.recipients ?? -1)}
            onClick={() => schedule(Number(typed.replace(/\D/g, '')))}
          >
            {t('CampaignEditor.confirmSend')}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
