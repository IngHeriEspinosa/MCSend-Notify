'use client';

/** Listado de plantillas con alta (nombre, formato e idioma), duplicado y borrado. */
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
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
  createTemplateAction,
  deleteTemplateAction,
  duplicateTemplateAction,
} from '@/app/_server/actions/templates.actions';
import { useAction } from '@/common/hooks/use-action';
import { Link, useRouter } from '@/common/i18n/navigation';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { AiDraftDialog } from '@/components/organisms/AiDraftDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import {
  emptyTemplateBody,
  TEMPLATE_FORMATS,
  type TemplateFormat,
} from '@/core/templates/email-content';
import type { TemplateSummary } from '@/core/templates/ports';

interface TemplatesTableProps {
  tenantSlug: string;
  templates: TemplateSummary[];
  canWrite: boolean;
  defaultLocale: 'es' | 'en';
  /** Zona horaria del tenant: misma salida en servidor y cliente (sin errores de hidratación). */
  timeZone: string;
  ai: { enabled: boolean; documents: Array<{ id: string; title: string }> };
}

export function TemplatesTable({
  tenantSlug,
  templates,
  canWrite,
  defaultLocale,
  timeZone,
  ai,
}: TemplatesTableProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const [creating, setCreating] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [format, setFormat] = useState<TemplateFormat>('BLOCKS');
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const templateLocale = form.get('locale') === 'en' ? 'en' : 'es';
    const body = {
      ...emptyTemplateBody(format, templateLocale),
      subject: String(form.get('subject') ?? ''),
    };
    void run(
      () =>
        createTemplateAction(tenantSlug, {
          name: String(form.get('name') ?? ''),
          description: '',
          body,
        }),
      { onSuccess: ({ id }) => router.push(`/t/${tenantSlug}/templates/${id}`) },
    );
  };

  const duplicate = (template: TemplateSummary) =>
    void run(
      () =>
        duplicateTemplateAction(tenantSlug, {
          templateId: template.id,
          name: t('Templates.copyName', { name: template.name }).slice(0, 120),
        }),
      {
        successMessage: t('Templates.duplicated'),
        onSuccess: ({ id }) => router.push(`/t/${tenantSlug}/templates/${id}`),
      },
    );

  return (
    <>
      {canWrite ? (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          {ai.enabled ? (
            <Button startIcon={<AutoAwesomeOutlined />} onClick={() => setDrafting(true)}>
              {t('AiDraft.open')}
            </Button>
          ) : null}
          <Button variant="contained" onClick={() => setCreating(true)}>
            {t('Templates.new')}
          </Button>
        </div>
      ) : null}

      {templates.length === 0 ? (
        <EmptyState message={t('Templates.empty')} />
      ) : (
        <TableContainer className="rounded-lg border border-line">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('Common.name')}</TableCell>
                <TableCell>{t('Templates.subject')}</TableCell>
                <TableCell>{t('Templates.format')}</TableCell>
                <TableCell>{t('Templates.version')}</TableCell>
                <TableCell>{t('Templates.updated')}</TableCell>
                <TableCell align="right">{t('Common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id} hover>
                  <TableCell>
                    <Link
                      href={`/t/${tenantSlug}/templates/${template.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {template.name}
                    </Link>
                    {template.description ? (
                      <Typography variant="body2" color="text.secondary">
                        {template.description}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{template.subject}</TableCell>
                  <TableCell>
                    <StatusChip label={t(`Templates.formats.${template.format}`)} />
                  </TableCell>
                  <TableCell>v{template.currentVersion}</TableCell>
                  <TableCell>{dateFormat.format(template.updatedAt)}</TableCell>
                  <TableCell align="right" className="whitespace-nowrap">
                    {canWrite ? (
                      <>
                        <IconButton
                          aria-label={`${t('Templates.duplicate')}: ${template.name}`}
                          onClick={() => duplicate(template)}
                          disabled={pending}
                        >
                          <ContentCopyOutlined />
                        </IconButton>
                        <IconButton
                          aria-label={`${t('Common.delete')}: ${template.name}`}
                          onClick={() => setDeleting(template)}
                        >
                          <DeleteOutlined />
                        </IconButton>
                      </>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="sm">
        <form onSubmit={create} noValidate>
          <DialogTitle>{t('Templates.new')}</DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            <TextField
              name="name"
              label={t('Common.name')}
              required
              autoFocus
              fullWidth
              margin="dense"
              error={Boolean(fieldErrors.name)}
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            <TextField
              name="subject"
              label={t('Templates.subject')}
              required
              fullWidth
              helperText={t('Templates.subjectHint')}
              error={Boolean(fieldErrors.body)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField
              select
              name="locale"
              label={t('Templates.locale')}
              defaultValue={defaultLocale}
              fullWidth
            >
              <MenuItem value="es">{t('Common.languages.es')}</MenuItem>
              <MenuItem value="en">{t('Common.languages.en')}</MenuItem>
            </TextField>
            <div className="flex flex-col gap-1">
              <FormLabel id="template-format-label">{t('Templates.format')}</FormLabel>
              <RadioGroup
                aria-labelledby="template-format-label"
                value={format}
                onChange={(event) => setFormat(event.target.value as TemplateFormat)}
              >
                {TEMPLATE_FORMATS.map((item) => (
                  <FormControlLabel
                    key={item}
                    value={item}
                    control={<Radio />}
                    label={
                      <span className="flex flex-col py-1">
                        <span className="font-medium">{t(`Templates.formats.${item}`)}</span>
                        <Typography variant="body2" color="text.secondary" component="span">
                          {t(`Templates.formatHints.${item}`)}
                        </Typography>
                      </span>
                    }
                  />
                ))}
              </RadioGroup>
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreating(false)}>{t('Common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {t('Common.create')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {ai.enabled ? (
        <AiDraftDialog
          tenantSlug={tenantSlug}
          open={drafting}
          onClose={() => setDrafting(false)}
          defaultLocale={defaultLocale}
          documents={ai.documents}
          onCreated={(id) => {
            setDrafting(false);
            router.push(`/t/${tenantSlug}/templates/${id}`);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={t('Templates.deleteTitle')}
        body={t('Templates.deleteBody')}
        confirmLabel={t('Common.delete')}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          void run(() => deleteTemplateAction(tenantSlug, { templateId: deleting.id }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => setDeleting(null),
          })
        }
      />
    </>
  );
}
