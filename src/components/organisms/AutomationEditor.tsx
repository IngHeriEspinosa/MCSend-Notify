'use client';

/**
 * Editor de una automatización: programación (preset + zona horaria), fuentes y redacción con IA,
 * audiencia y remitente, y aprobación humana (activada por defecto).
 */
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  createAutomationAction,
  updateAutomationAction,
} from '@/app/_server/actions/automations.actions';
import { useAction } from '@/common/hooks/use-action';
import { useRouter } from '@/common/i18n/navigation';
import { describeSchedule, formatTime, weekdayName } from '@/common/utils/automations-ui';
import { MultiSelectField, type MultiSelectOption } from '@/components/molecules/MultiSelectField';
import { SourcesEditor, type SourceDocumentOption } from '@/components/molecules/SourcesEditor';
import { AI_TONES, type AiTone } from '@/core/ai/ai';
import type { DraftSource } from '@/core/ai/sources';
import {
  ON_TIMEOUT_ACTIONS,
  type AutomationDefinition,
  type AutomationInput,
  type AutomationSchedule,
  type OnTimeoutAction,
} from '@/core/automations/automation';

const NONE = 'none';
const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

interface AutomationEditorProps {
  tenantSlug: string;
  automation?: {
    id: string;
    name: string;
    schedule: AutomationSchedule;
    timezone: string;
    definition: AutomationDefinition;
  };
  defaultTimezone: string;
  defaultLocale: 'es' | 'en';
  lists: MultiSelectOption[];
  segments: MultiSelectOption[];
  topics: MultiSelectOption[];
  senders: MultiSelectOption[];
  approvers: MultiSelectOption[];
  documents: SourceDocumentOption[];
  canWrite: boolean;
}

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

function timeZones(fallback: string): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [fallback];
  }
}

export function AutomationEditor({
  tenantSlug,
  automation,
  defaultTimezone,
  defaultLocale,
  lists,
  segments,
  topics,
  senders,
  approvers,
  documents,
  canWrite,
}: AutomationEditorProps) {
  const t = useTranslations();
  const uiLocale = useLocale();
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const initial = automation?.definition;

  const [name, setName] = useState(automation?.name ?? '');
  const [schedule, setSchedule] = useState<AutomationSchedule>(
    automation?.schedule ?? { frequency: 'weekly', weekday: 1, hour: 9, minute: 0 },
  );
  const [timezone, setTimezone] = useState(automation?.timezone ?? defaultTimezone);
  const [sources, setSources] = useState<DraftSource[]>(
    initial?.sources ?? [{ kind: 'changelog', days: 7, onlyNew: true }],
  );
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [tone, setTone] = useState<AiTone>(initial?.tone ?? 'professional');
  const [locale, setLocale] = useState<'es' | 'en'>(initial?.locale ?? defaultLocale);
  const [listIds, setListIds] = useState(initial?.audience.listIds ?? []);
  const [segmentIds, setSegmentIds] = useState(initial?.audience.segmentIds ?? []);
  const [excludeListIds, setExcludeListIds] = useState(initial?.audience.excludeListIds ?? []);
  const [topicId, setTopicId] = useState(initial?.topicId ?? NONE);
  const [senderId, setSenderId] = useState(initial?.senderIdentityId ?? senders[0]?.id ?? '');
  const [requiresApproval, setRequiresApproval] = useState(initial?.requiresApproval ?? true);
  const [approverIds, setApproverIds] = useState(initial?.approverUserIds ?? []);
  const [timeoutHours, setTimeoutHours] = useState(initial?.approvalTimeoutHours ?? 48);
  const [onTimeout, setOnTimeout] = useState<OnTimeoutAction>(initial?.onTimeout ?? 'cancel');
  const [skipWhenNoNews, setSkipWhenNoNews] = useState(initial?.skipWhenNoNews ?? true);
  const zones = useMemo(() => timeZones(defaultTimezone), [defaultTimezone]);
  const disabled = !canWrite;

  const scheduleText = describeSchedule(schedule, uiLocale, (key, values) =>
    t(`Automations.schedules.${key}`, values),
  );

  const setFrequency = (frequency: (typeof FREQUENCIES)[number]) => {
    const time = { hour: schedule.hour, minute: schedule.minute };
    if (frequency === 'daily') setSchedule({ frequency, ...time });
    if (frequency === 'weekly') setSchedule({ frequency, weekday: 1, ...time });
    if (frequency === 'monthly') setSchedule({ frequency, dayOfMonth: 1, ...time });
  };

  const setTime = (value: string) => {
    const [hour = '9', minute = '0'] = value.split(':');
    setSchedule({ ...schedule, hour: Number(hour), minute: Number(minute) });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input: AutomationInput = {
      name,
      schedule,
      timezone,
      definition: {
        sources,
        instructions,
        tone,
        locale,
        audience: { listIds, segmentIds, excludeListIds },
        topicId: topicId === NONE ? null : topicId,
        senderIdentityId: senderId,
        requiresApproval,
        approverUserIds: requiresApproval ? approverIds : [],
        approvalTimeoutHours: timeoutHours,
        onTimeout,
        skipWhenNoNews,
      },
    };
    if (automation) {
      void run(() => updateAutomationAction(tenantSlug, { id: automation.id, automation: input }), {
        successMessage: t('Automations.saved'),
      });
    } else {
      void run(() => createAutomationAction(tenantSlug, input), {
        successMessage: t('Automations.created'),
        onSuccess: ({ id }) => router.push(`/t/${tenantSlug}/automations/${id}`),
      });
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Section title={t('Automations.sections.schedule')}>
        <TextField
          label={t('Common.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          disabled={disabled}
          error={Boolean(fieldErrors.name)}
          slotProps={{ htmlInput: { maxLength: 120 } }}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <TextField
            select
            label={t('Automations.frequency')}
            value={schedule.frequency}
            onChange={(event) =>
              setFrequency(FREQUENCIES.find((item) => item === event.target.value) ?? 'weekly')
            }
            disabled={disabled}
          >
            {FREQUENCIES.map((frequency) => (
              <MenuItem key={frequency} value={frequency}>
                {t(`Automations.frequencies.${frequency}`)}
              </MenuItem>
            ))}
          </TextField>
          {schedule.frequency === 'weekly' ? (
            <TextField
              select
              label={t('Automations.weekday')}
              value={schedule.weekday}
              onChange={(event) =>
                setSchedule({ ...schedule, weekday: Number(event.target.value) })
              }
              disabled={disabled}
            >
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <MenuItem key={day} value={day}>
                  {weekdayName(day, uiLocale)}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {schedule.frequency === 'monthly' ? (
            <TextField
              type="number"
              label={t('Automations.dayOfMonth')}
              value={schedule.dayOfMonth}
              onChange={(event) =>
                setSchedule({
                  ...schedule,
                  dayOfMonth: Math.min(28, Math.max(1, Number(event.target.value) || 1)),
                })
              }
              disabled={disabled}
              slotProps={{ htmlInput: { min: 1, max: 28 } }}
            />
          ) : null}
          <TextField
            type="time"
            label={t('Automations.time')}
            value={formatTime(schedule.hour, schedule.minute)}
            onChange={(event) => setTime(event.target.value)}
            disabled={disabled}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Autocomplete
            options={zones}
            value={timezone}
            onChange={(_event, value) => setTimezone(value ?? defaultTimezone)}
            disableClearable
            disabled={disabled}
            renderInput={(params) => <TextField {...params} label={t('Automations.timezone')} />}
          />
        </div>
        <Typography variant="body2" color="text.secondary" aria-live="polite">
          {t('Automations.scheduleSummary', { schedule: scheduleText, timezone })}
        </Typography>
      </Section>

      <Section title={t('Automations.sections.content')}>
        <SourcesEditor sources={sources} onChange={setSources} documents={documents} />
        <FormControlLabel
          control={
            <Switch
              checked={skipWhenNoNews}
              onChange={(event) => setSkipWhenNoNews(event.target.checked)}
              disabled={disabled}
            />
          }
          label={t('Automations.skipWhenNoNews')}
        />
        <TextField
          label={t('AiDraft.instructions')}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          multiline
          minRows={3}
          disabled={disabled}
          helperText={t('Automations.instructionsHint')}
          slotProps={{ htmlInput: { maxLength: 4000 } }}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            select
            label={t('AiDraft.tone')}
            value={tone}
            onChange={(event) =>
              setTone(AI_TONES.find((item) => item === event.target.value) ?? 'professional')
            }
            disabled={disabled}
          >
            {AI_TONES.map((item) => (
              <MenuItem key={item} value={item}>
                {t(`AiDraft.tones.${item}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('Templates.locale')}
            value={locale}
            onChange={(event) => setLocale(event.target.value === 'en' ? 'en' : 'es')}
            disabled={disabled}
          >
            <MenuItem value="es">{t('Common.languages.es')}</MenuItem>
            <MenuItem value="en">{t('Common.languages.en')}</MenuItem>
          </TextField>
        </div>
      </Section>

      <Section title={t('Automations.sections.audience')}>
        <MultiSelectField
          label={t('CampaignEditor.lists')}
          options={lists}
          value={listIds}
          onChange={setListIds}
          disabled={disabled}
        />
        <MultiSelectField
          label={t('CampaignEditor.segments')}
          options={segments}
          value={segmentIds}
          onChange={setSegmentIds}
          disabled={disabled}
        />
        <MultiSelectField
          label={t('CampaignEditor.excludeLists')}
          options={lists}
          value={excludeListIds}
          onChange={setExcludeListIds}
          disabled={disabled}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            select
            label={t('CampaignEditor.topic')}
            value={topicId}
            onChange={(event) => setTopicId(event.target.value)}
            disabled={disabled}
            helperText={t('CampaignEditor.topicHint')}
          >
            <MenuItem value={NONE}>{t('CampaignEditor.noTopic')}</MenuItem>
            {topics.map((topic) => (
              <MenuItem key={topic.id} value={topic.id}>
                {topic.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('CampaignEditor.sender')}
            value={senderId}
            onChange={(event) => setSenderId(event.target.value)}
            disabled={disabled || senders.length === 0}
            required
            helperText={senders.length === 0 ? t('CampaignEditor.noSenders') : undefined}
          >
            {senders.map((sender) => (
              <MenuItem key={sender.id} value={sender.id}>
                {sender.label}
              </MenuItem>
            ))}
          </TextField>
        </div>
      </Section>

      <Section title={t('Automations.sections.approval')}>
        <FormControlLabel
          control={
            <Switch
              checked={requiresApproval}
              onChange={(event) => setRequiresApproval(event.target.checked)}
              disabled={disabled}
            />
          }
          label={t('Automations.requiresApproval')}
        />
        {requiresApproval ? (
          <>
            <MultiSelectField
              label={t('Automations.approvers')}
              options={approvers}
              value={approverIds}
              onChange={setApproverIds}
              disabled={disabled}
              helperText={t('Automations.approversHint')}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                type="number"
                label={t('Automations.timeoutHours')}
                value={timeoutHours}
                onChange={(event) =>
                  setTimeoutHours(Math.min(168, Math.max(1, Number(event.target.value) || 1)))
                }
                disabled={disabled}
                slotProps={{ htmlInput: { min: 1, max: 168 } }}
              />
              <TextField
                select
                label={t('Automations.onTimeout')}
                value={onTimeout}
                onChange={(event) =>
                  setOnTimeout(
                    ON_TIMEOUT_ACTIONS.find((item) => item === event.target.value) ?? 'cancel',
                  )
                }
                disabled={disabled}
              >
                {ON_TIMEOUT_ACTIONS.map((action) => (
                  <MenuItem key={action} value={action}>
                    {t(`Automations.onTimeoutActions.${action}`)}
                  </MenuItem>
                ))}
              </TextField>
            </div>
          </>
        ) : (
          <Alert severity="warning">{t('Automations.noApprovalWarning')}</Alert>
        )}
      </Section>

      {fieldErrors.definition || fieldErrors.schedule ? (
        <Alert severity="error" role="alert">
          {t('Automations.definitionError')}
        </Alert>
      ) : null}

      {canWrite ? (
        <div>
          <Button type="submit" variant="contained" size="large" disabled={pending}>
            {pending ? t('Common.saving') : t('Common.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
