'use client';

/**
 * "Redactar con IA": reúne fuentes, genera un borrador, lo muestra en una vista previa aislada
 * y, si la persona lo acepta, lo guarda como plantilla nueva. La IA nunca envía nada.
 */
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { draftCampaignAction } from '@/app/_server/actions/ai.actions';
import {
  createTemplateAction,
  previewTemplateAction,
} from '@/app/_server/actions/templates.actions';
import { useAction } from '@/common/hooks/use-action';
import { EmailPreviewFrame } from '@/components/molecules/EmailPreviewFrame';
import { SourcesEditor, type SourceDocumentOption } from '@/components/molecules/SourcesEditor';
import { AI_TONES, type AiTone } from '@/core/ai/ai';
import type { DraftSource } from '@/core/ai/sources';
import type { DraftResult } from '@/core/ai/use-cases/ai-assist.use-cases';

interface AiDraftDialogProps {
  tenantSlug: string;
  open: boolean;
  onClose: () => void;
  defaultLocale: 'es' | 'en';
  documents: SourceDocumentOption[];
  /** Plantilla creada a partir del borrador aceptado. */
  onCreated: (templateId: string) => void;
}

export function AiDraftDialog({
  tenantSlug,
  open,
  onClose,
  defaultLocale,
  documents,
  onCreated,
}: AiDraftDialogProps) {
  const t = useTranslations();
  const uiLocale = useLocale();
  const { run, pending } = useAction();
  const [sources, setSources] = useState<DraftSource[]>([{ kind: 'text', title: '', text: '' }]);
  const [instructions, setInstructions] = useState('');
  const [tone, setTone] = useState<AiTone>('professional');
  const [locale, setLocale] = useState<'es' | 'en'>(defaultLocale);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const [name, setName] = useState('');
  const usd = new Intl.NumberFormat(uiLocale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4,
  });

  const reset = () => {
    setDraft(null);
    setPreviewHtml('');
  };

  const generate = () =>
    void run(() => draftCampaignAction(tenantSlug, { sources, instructions, tone, locale }), {
      onSuccess: async (result) => {
        setDraft(result);
        setName(t('AiDraft.defaultName', { subject: result.body.subject }).slice(0, 120));
        const preview = await previewTemplateAction(tenantSlug, {
          body: result.body,
          contactId: null,
          colorScheme: 'light',
        });
        setPreviewHtml(preview.ok ? preview.data.html : '');
      },
    });

  const accept = () => {
    if (!draft) return;
    void run(
      () =>
        createTemplateAction(tenantSlug, {
          name,
          description: t('AiDraft.description'),
          body: draft.body,
        }),
      {
        successMessage: t('AiDraft.created'),
        onSuccess: ({ id }) => {
          reset();
          onCreated(id);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={pending ? undefined : onClose}
      fullWidth
      maxWidth={draft ? 'lg' : 'md'}
      aria-labelledby="ai-draft-title"
    >
      <DialogTitle id="ai-draft-title" className="flex items-center gap-2">
        <AutoAwesomeOutlined color="primary" aria-hidden />
        {t('AiDraft.title')}
      </DialogTitle>
      {pending ? <LinearProgress aria-label={t('AiDraft.generating')} /> : null}
      <DialogContent className="flex flex-col gap-4 pt-2">
        {draft ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="flex flex-col gap-3">
              <Typography variant="body2">
                <strong>{t('Templates.subject')}:</strong> {draft.body.subject}
              </Typography>
              {draft.removedLinks.length > 0 ? (
                <Alert severity="warning">
                  {t('AiDraft.removedLinks', { count: draft.removedLinks.length })}
                  <ul className="mt-1 list-disc pl-5 break-all">
                    {draft.removedLinks.slice(0, 5).map((link) => (
                      <li key={link}>{link}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
              <Typography variant="body2" color="text.secondary">
                {t('AiDraft.sourcesUsed', {
                  sources: draft.sources.map((source) => source.title || source.kind).join(', '),
                })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('AiDraft.cost', { cost: usd.format(draft.costMicros / 1_000_000) })}
              </Typography>
              <Alert severity="info">{t('AiDraft.reviewHint')}</Alert>
              <TextField
                label={t('AiDraft.templateName')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                fullWidth
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
            </div>
            <EmailPreviewFrame html={previewHtml} device="desktop" dark={false} busy={pending} />
          </div>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {t('AiDraft.intro')}
            </Typography>
            <SourcesEditor sources={sources} onChange={setSources} documents={documents} />
            <TextField
              label={t('AiDraft.instructions')}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              multiline
              minRows={2}
              fullWidth
              helperText={t('AiDraft.instructionsHint')}
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
              >
                <MenuItem value="es">{t('Common.languages.es')}</MenuItem>
                <MenuItem value="en">{t('Common.languages.en')}</MenuItem>
              </TextField>
            </div>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={pending}>
          {t('Common.cancel')}
        </Button>
        {draft ? (
          <>
            <Button onClick={reset} disabled={pending}>
              {t('AiDraft.back')}
            </Button>
            <Button
              variant="contained"
              onClick={accept}
              disabled={pending || name.trim().length < 2}
            >
              {t('AiDraft.accept')}
            </Button>
          </>
        ) : (
          <Button
            variant="contained"
            startIcon={<AutoAwesomeOutlined />}
            onClick={generate}
            disabled={pending || sources.length === 0}
          >
            {pending ? t('AiDraft.generating') : t('AiDraft.generate')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
