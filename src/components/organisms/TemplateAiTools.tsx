'use client';

/**
 * Asistente de IA del editor de plantillas:
 * - Propuestas de asunto con avisos de riesgo (mayúsculas, palabras de spam...).
 * - Ajuste de tono: reemplaza los textos en el editor; la persona revisa y guarda.
 * - Traducción: crea una copia de la plantilla en el otro idioma.
 * La IA solo reescribe textos: URL, documentos y estructura nunca cambian.
 */
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  adjustToneAction,
  suggestSubjectsAction,
  translateTemplateAction,
} from '@/app/_server/actions/ai.actions';
import { createTemplateAction } from '@/app/_server/actions/templates.actions';
import { useNotify } from '@/common/hooks/notifications';
import { useAction } from '@/common/hooks/use-action';
import { useRouter } from '@/common/i18n/navigation';
import { AI_TONES, type AiTone } from '@/core/ai/ai';
import type { SubjectSuggestion } from '@/core/ai/use-cases/ai-assist.use-cases';
import type { TemplateBody } from '@/core/templates/email-content';

interface TemplateAiToolsProps {
  tenantSlug: string;
  name: string;
  body: TemplateBody;
  onBodyChange: (body: TemplateBody) => void;
}

export function TemplateAiTools({ tenantSlug, name, body, onBodyChange }: TemplateAiToolsProps) {
  const t = useTranslations();
  const notify = useNotify();
  const router = useRouter();
  const { run, pending } = useAction();
  const [tone, setTone] = useState<AiTone>('friendly');
  const [subjects, setSubjects] = useState<SubjectSuggestion[] | null>(null);
  const target = body.locale === 'es' ? 'en' : 'es';

  const reportRejected = (rejected: string[]) => {
    if (rejected.length > 0)
      notify(t('TemplateAi.rejected', { count: rejected.length }), 'warning');
  };

  const suggest = () =>
    void run(() => suggestSubjectsAction(tenantSlug, { body }), {
      onSuccess: (result) => setSubjects(result.subjects),
    });

  const adjust = () =>
    void run(() => adjustToneAction(tenantSlug, { body, tone }), {
      successMessage: t('TemplateAi.toneApplied'),
      onSuccess: (result) => {
        onBodyChange(result.body);
        reportRejected(result.rejected);
      },
    });

  const translate = () =>
    void run(() => translateTemplateAction(tenantSlug, { body, targetLocale: target }), {
      onSuccess: (result) => {
        reportRejected(result.rejected);
        void run(
          () =>
            createTemplateAction(tenantSlug, {
              name: `${name} (${target.toUpperCase()})`.slice(0, 120),
              description: t('TemplateAi.translatedFrom', { name }).slice(0, 300),
              body: result.body,
            }),
          {
            successMessage: t('TemplateAi.translated'),
            onSuccess: ({ id }) => router.push(`/t/${tenantSlug}/templates/${id}`),
          },
        );
      },
    });

  return (
    <Paper variant="outlined" component="section" className="flex flex-col gap-4 p-4">
      <Typography variant="h6" component="h2" className="flex items-center gap-2">
        <AutoAwesomeOutlined color="primary" aria-hidden />
        {t('TemplateAi.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('TemplateAi.hint')}
      </Typography>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outlined" onClick={suggest} disabled={pending}>
          {t('TemplateAi.suggestSubjects')}
        </Button>
        <Button variant="outlined" onClick={translate} disabled={pending}>
          {t('TemplateAi.translateTo', { language: t(`Common.languages.${target}`) })}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TextField
          select
          size="small"
          label={t('AiDraft.tone')}
          value={tone}
          onChange={(event) =>
            setTone(AI_TONES.find((item) => item === event.target.value) ?? 'friendly')
          }
          className="min-w-48"
        >
          {AI_TONES.map((item) => (
            <MenuItem key={item} value={item}>
              {t(`AiDraft.tones.${item}`)}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="outlined" onClick={adjust} disabled={pending}>
          {t('TemplateAi.adjustTone')}
        </Button>
      </div>

      <Dialog open={subjects !== null} onClose={() => setSubjects(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('TemplateAi.subjectsTitle')}</DialogTitle>
        <DialogContent>
          {subjects?.length === 0 ? (
            <Typography color="text.secondary">{t('TemplateAi.noSubjects')}</Typography>
          ) : (
            <List>
              {subjects?.map((suggestion) => (
                <ListItem
                  key={suggestion.text}
                  divider
                  secondaryAction={
                    <Button
                      onClick={() => {
                        onBodyChange({ ...body, subject: suggestion.text });
                        setSubjects(null);
                      }}
                    >
                      {t('TemplateAi.use')}
                    </Button>
                  }
                >
                  <ListItemText
                    className="pr-16"
                    primary={suggestion.text}
                    secondary={
                      <span className="flex flex-col gap-1">
                        <span>{suggestion.rationale}</span>
                        <span className="flex flex-wrap gap-1">
                          <Chip
                            size="small"
                            label={t('TemplateAi.length', { count: suggestion.length })}
                          />
                          {suggestion.flags.map((flag) => (
                            <Chip
                              key={flag}
                              size="small"
                              color="warning"
                              label={t(`TemplateAi.flags.${flag}`)}
                            />
                          ))}
                        </span>
                      </span>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubjects(null)}>{t('Common.close')}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
