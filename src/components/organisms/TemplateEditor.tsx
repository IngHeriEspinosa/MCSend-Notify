'use client';

/**
 * Editor de plantillas: datos del mensaje, contenido según el formato (bloques, Markdown o HTML),
 * vista previa en vivo (escritorio/móvil, claro/oscuro, contacto real o de ejemplo), comprobaciones
 * previas al envío, variables disponibles e historial de versiones con restauración.
 */
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import DesktopWindowsOutlined from '@mui/icons-material/DesktopWindowsOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import PhoneIphoneOutlined from '@mui/icons-material/PhoneIphoneOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  previewTemplateAction,
  restoreTemplateVersionAction,
  saveTemplateAction,
} from '@/app/_server/actions/templates.actions';
import { useNotify } from '@/common/hooks/notifications';
import { useAction } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmailPreviewFrame } from '@/components/molecules/EmailPreviewFrame';
import type { EmailBlock, TemplateBody } from '@/core/templates/email-content';
import type { TemplateVersionSummary } from '@/core/templates/ports';
import type { TemplateIssue } from '@/core/templates/template-issues';
import { CONTACT_VARIABLES, SYSTEM_VARIABLES } from '@/core/templates/template-variables';
import { BlockEditor, type DocumentOption } from './BlockEditor';

const PREVIEW_DEBOUNCE_MS = 600;
/** Valor del selector para el contacto de ejemplo (MUI no muestra la opción de valor vacío). */
const SAMPLE_CONTACT = 'sample';

const VARIABLE_LABELS = {
  'contact.first_name': 'firstName',
  'contact.last_name': 'lastName',
  'contact.full_name': 'fullName',
  'contact.email': 'email',
  'contact.company': 'company',
  'tenant.name': 'tenantName',
  unsubscribe_url: 'unsubscribeUrl',
  preferences_url: 'preferencesUrl',
  current_year: 'currentYear',
} as const satisfies Record<
  (typeof CONTACT_VARIABLES)[number] | (typeof SYSTEM_VARIABLES)[number],
  string
>;

interface PreviewState {
  html: string;
  subject: string;
  sizeBytes: number;
  issues: TemplateIssue[];
  invalid: boolean;
}

interface TemplateEditorProps {
  tenantSlug: string;
  template: {
    id: string;
    name: string;
    description: string | null;
    currentVersion: number;
    body: TemplateBody;
  };
  versions: TemplateVersionSummary[];
  documents: DocumentOption[];
  fields: Array<{ key: string; label: string }>;
  contacts: Array<{ id: string; label: string }>;
  canWrite: boolean;
  timeZone: string;
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

export function TemplateEditor({
  tenantSlug,
  template,
  versions,
  documents,
  fields,
  contacts,
  canWrite,
  timeZone,
}: TemplateEditorProps) {
  const t = useTranslations();
  const locale = useLocale();
  const notify = useNotify();
  const { run, pending, fieldErrors } = useAction();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [body, setBody] = useState<TemplateBody>(template.body);
  const [version, setVersion] = useState(template.currentVersion);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(() =>
    JSON.stringify({
      name: template.name,
      description: template.description ?? '',
      body: template.body,
    }),
  );
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [dark, setDark] = useState(false);
  const [contactId, setContactId] = useState(SAMPLE_CONTACT);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  const requestId = useRef(0);
  const disabled = !canWrite;

  const snapshot = useMemo(
    () => JSON.stringify({ name, description, body }),
    [name, description, body],
  );
  const dirty = snapshot !== saved;
  const bodyKey = useMemo(() => JSON.stringify(body), [body]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const current = ++requestId.current;
    const timer = setTimeout(async () => {
      setPreviewBusy(true);
      const result = await previewTemplateAction(tenantSlug, {
        body: JSON.parse(bodyKey) as TemplateBody,
        contactId: contactId === SAMPLE_CONTACT ? null : contactId,
        colorScheme: dark ? 'dark' : 'light',
      });
      if (current !== requestId.current) return;
      setPreviewBusy(false);
      if (result.ok) {
        setPreview({ ...result.data, invalid: false });
      } else {
        setPreview((previous) =>
          previous
            ? { ...previous, invalid: true }
            : { html: '', subject: '', sizeBytes: 0, issues: [], invalid: true },
        );
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [bodyKey, contactId, dark, tenantSlug]);

  const updateBody = (patch: Partial<Pick<TemplateBody, 'subject' | 'preheader' | 'locale'>>) =>
    setBody((current) => ({ ...current, ...patch }));

  const save = () =>
    void run(
      () =>
        saveTemplateAction(tenantSlug, {
          templateId: template.id,
          expectedVersion: version,
          name,
          description,
          note,
          body,
        }),
      {
        successMessage: t('TemplateEditor.saved'),
        onSuccess: ({ currentVersion }) => {
          setVersion(currentVersion);
          setSaved(snapshot);
          setNote('');
        },
      },
    );

  const restore = (target: number) =>
    void run(
      () => restoreTemplateVersionAction(tenantSlug, { templateId: template.id, version: target }),
      {
        successMessage: t('TemplateEditor.restored', { version: target }),
        onSuccess: (data) => {
          setBody(data.body);
          setVersion(data.currentVersion);
          setSaved(JSON.stringify({ name, description, body: data.body }));
          setRestoring(null);
          setHistoryOpen(false);
        },
      },
    );

  const copyVariable = async (variable: string) => {
    await navigator.clipboard.writeText(`{{ ${variable} }}`);
    notify(t('Common.copied'), 'success');
  };

  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
  const variables = [
    ...CONTACT_VARIABLES.map((key) => ({
      key,
      label: t(`TemplateEditor.variables.${VARIABLE_LABELS[key]}`),
    })),
    ...fields.map((field) => ({ key: `fields.${field.key}`, label: field.label })),
    ...SYSTEM_VARIABLES.map((key) => ({
      key,
      label: t(`TemplateEditor.variables.${VARIABLE_LABELS[key]}`),
    })),
  ];
  const errors = preview?.issues.filter((issue) => issue.severity === 'error') ?? [];
  const warnings = preview?.issues.filter((issue) => issue.severity === 'warning') ?? [];

  const content = (() => {
    switch (body.format) {
      case 'BLOCKS':
        return (
          <BlockEditor
            blocks={body.content.blocks}
            onChange={(blocks: EmailBlock[]) => setBody({ ...body, content: { blocks } })}
            documents={documents}
            disabled={disabled}
          />
        );
      case 'MARKDOWN':
        return (
          <TextField
            label={t('TemplateEditor.markdownContent')}
            value={body.content.markdown}
            onChange={(event) => setBody({ ...body, content: { markdown: event.target.value } })}
            disabled={disabled}
            multiline
            minRows={16}
            fullWidth
            helperText={t('Blocks.markdownHint')}
            slotProps={{ htmlInput: { maxLength: 50000, className: 'font-mono text-sm' } }}
          />
        );
      case 'HTML':
        return (
          <TextField
            label={t('TemplateEditor.htmlContent')}
            value={body.content.html}
            onChange={(event) => setBody({ ...body, content: { html: event.target.value } })}
            disabled={disabled}
            multiline
            minRows={18}
            fullWidth
            helperText={t('TemplateEditor.htmlHint')}
            slotProps={{
              htmlInput: { maxLength: 200000, className: 'font-mono text-sm', spellCheck: false },
            }}
          />
        );
    }
  })();

  return (
    <div className="flex flex-col gap-6 pb-24">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={t('TemplateEditor.details')}>
            <TextField
              label={t('Common.name')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={disabled}
              required
              error={Boolean(fieldErrors.name)}
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            <TextField
              label={t('Common.description')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={disabled}
              slotProps={{ htmlInput: { maxLength: 300 } }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip label={t(`Templates.formats.${body.format}`)} tone="primary" />
              <StatusChip label={`v${version}`} />
            </div>
          </Section>

          <Section title={t('TemplateEditor.message')}>
            <TextField
              label={t('Templates.subject')}
              value={body.subject}
              onChange={(event) => updateBody({ subject: event.target.value })}
              disabled={disabled}
              required
              helperText={t('TemplateEditor.subjectCount', { count: body.subject.length })}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField
              label={t('TemplateEditor.preheader')}
              value={body.preheader ?? ''}
              onChange={(event) => updateBody({ preheader: event.target.value })}
              disabled={disabled}
              helperText={t('TemplateEditor.preheaderHint')}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField
              select
              label={t('Templates.locale')}
              value={body.locale}
              onChange={(event) =>
                updateBody({ locale: event.target.value === 'en' ? 'en' : 'es' })
              }
              disabled={disabled}
              helperText={t('TemplateEditor.localeHint')}
            >
              <MenuItem value="es">{t('Common.languages.es')}</MenuItem>
              <MenuItem value="en">{t('Common.languages.en')}</MenuItem>
            </TextField>
          </Section>

          <Section title={t('TemplateEditor.content')}>{content}</Section>

          <Accordion variant="outlined" disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
              <Typography component="h2" variant="subtitle1">
                {t('TemplateEditor.variablesTitle')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Typography variant="body2" color="text.secondary" className="mb-2">
                {t('TemplateEditor.variablesHint')}
              </Typography>
              <List dense>
                {variables.map((variable) => (
                  <ListItem
                    key={variable.key}
                    secondaryAction={
                      <IconButton
                        edge="end"
                        aria-label={`${t('Common.copy')}: ${variable.key}`}
                        onClick={() => void copyVariable(variable.key)}
                      >
                        <ContentCopyOutlined fontSize="small" />
                      </IconButton>
                    }
                  >
                    <ListItemText
                      primary={<code className="text-sm">{`{{ ${variable.key} }}`}</code>}
                      secondary={variable.label}
                    />
                  </ListItem>
                ))}
              </List>
            </AccordionDetails>
          </Accordion>
        </div>

        <div className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-20 xl:self-start">
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
              onChange={(_event, next: 'dark' | 'light' | null) => next && setDark(next === 'dark')}
            >
              <ToggleButton value="light" aria-label={t('Common.themeLight')}>
                <LightModeOutlined fontSize="small" />
              </ToggleButton>
              <ToggleButton value="dark" aria-label={t('Common.themeDark')}>
                <DarkModeOutlined fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>
            <TextField
              select
              size="small"
              label={t('TemplateEditor.previewContact')}
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className="min-w-56 flex-1"
            >
              <MenuItem value={SAMPLE_CONTACT}>{t('TemplateEditor.sampleContact')}</MenuItem>
              {contacts.map((contact) => (
                <MenuItem key={contact.id} value={contact.id}>
                  {contact.label}
                </MenuItem>
              ))}
            </TextField>
          </div>

          {preview?.invalid ? (
            <Alert severity="warning">{t('TemplateEditor.previewInvalid')}</Alert>
          ) : null}
          {preview ? (
            <Typography variant="body2" className="truncate">
              <span className="font-semibold">{t('Templates.subject')}:</span> {preview.subject}
            </Typography>
          ) : null}
          <EmailPreviewFrame
            html={preview?.html ?? ''}
            device={device}
            dark={dark}
            busy={previewBusy}
          />

          <section
            aria-labelledby="template-checks"
            aria-live="polite"
            className="flex flex-col gap-2"
          >
            <Typography id="template-checks" variant="subtitle1" component="h2">
              {t('TemplateEditor.checks')}
            </Typography>
            {preview && preview.issues.length === 0 ? (
              <Alert severity="success">{t('TemplateEditor.noIssues')}</Alert>
            ) : null}
            <ul className="flex flex-col gap-1">
              {[...errors, ...warnings].map((issue) => (
                <li key={`${issue.code}-${issue.detail ?? ''}`} className="flex items-start gap-2">
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
                    {t(`TemplateIssues.${issue.code}`, { detail: issue.detail ?? '' })}
                  </Typography>
                </li>
              ))}
            </ul>
            {preview ? (
              <Typography variant="caption" color="text.secondary">
                {t('TemplateEditor.size', { kb: Math.ceil(preview.sizeBytes / 1024) })}
              </Typography>
            ) : null}
          </section>
        </div>
      </div>

      <Paper
        elevation={6}
        className="fixed inset-x-0 bottom-0 z-20 flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-end md:left-[264px]"
      >
        {dirty ? (
          <Typography variant="body2" color="text.secondary" className="sm:mr-auto" role="status">
            {t('TemplateEditor.unsaved')}
          </Typography>
        ) : null}
        <Button startIcon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
          {t('TemplateEditor.history')}
        </Button>
        {canWrite ? (
          <>
            <TextField
              size="small"
              label={t('TemplateEditor.versionNote')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="sm:w-72"
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <Button variant="contained" onClick={save} disabled={pending || !dirty}>
              {pending ? t('Common.saving') : t('TemplateEditor.saveVersion')}
            </Button>
          </>
        ) : null}
      </Paper>

      <Drawer anchor="right" open={historyOpen} onClose={() => setHistoryOpen(false)}>
        <div className="flex w-[22rem] max-w-[100vw] flex-col gap-2 p-4">
          <Typography variant="h6" component="h2">
            {t('TemplateEditor.history')}
          </Typography>
          <List>
            {versions.map((item) => {
              const restoredFrom = item.note?.startsWith('restore:') ? item.note.slice(8) : null;
              return (
                <ListItem
                  key={item.version}
                  divider
                  secondaryAction={
                    canWrite && item.version !== version ? (
                      <Button size="small" onClick={() => setRestoring(item.version)}>
                        {t('TemplateEditor.restore')}
                      </Button>
                    ) : null
                  }
                >
                  <ListItemText
                    primary={`v${item.version}${item.version === version ? ` · ${t('TemplateEditor.current')}` : ''}`}
                    secondary={[
                      dateFormat.format(item.createdAt),
                      item.createdByName,
                      restoredFrom
                        ? t('TemplateEditor.restoredFrom', { version: restoredFrom })
                        : item.note,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </ListItem>
              );
            })}
          </List>
        </div>
      </Drawer>

      <ConfirmDialog
        open={restoring !== null}
        title={t('TemplateEditor.restoreTitle', { version: restoring ?? 0 })}
        body={t('TemplateEditor.restoreBody')}
        confirmLabel={t('TemplateEditor.restore')}
        pending={pending}
        onClose={() => setRestoring(null)}
        onConfirm={() => restoring !== null && restore(restoring)}
      />
    </div>
  );
}
