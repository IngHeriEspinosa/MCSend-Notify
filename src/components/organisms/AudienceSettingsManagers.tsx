'use client';

/** Gestores de campos personalizados, etiquetas y temas de suscripción. */
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  createContactFieldAction,
  createTagSettingsAction,
  createTopicAction,
  deleteContactFieldAction,
  deleteTagAction,
  deleteTopicAction,
  updateTopicAction,
} from '@/app/_server/actions/settings.actions';
import { useAction } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import {
  FIELD_TYPES,
  type ContactFieldDefinition,
  type FieldType,
} from '@/core/contacts/contact-fields';
import type { TagView, TopicView } from '@/core/contacts/ports';

interface CrudShellProps {
  createLabel: string;
  emptyMessage: string;
  isEmpty: boolean;
  headers: string[];
  rows: ReactNode;
  onCreate: () => void;
}

function CrudShell({
  createLabel,
  emptyMessage,
  isEmpty,
  headers,
  rows,
  onCreate,
}: CrudShellProps) {
  const t = useTranslations('Common');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="contained" onClick={onCreate}>
          {createLabel}
        </Button>
      </div>
      {isEmpty ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <TableContainer className="rounded-lg border border-line">
          <Table>
            <TableHead>
              <TableRow>
                {headers.map((header) => (
                  <TableCell key={header}>{header}</TableCell>
                ))}
                <TableCell align="right">{t('actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{rows}</TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}

function useDeletion<T extends { id: string }>(
  tenantSlug: string,
  action: (slug: string, input: { id: string }) => ReturnType<typeof deleteTagAction>,
) {
  const t = useTranslations('Common');
  const { run, pending } = useAction();
  const [target, setTarget] = useState<T | null>(null);
  const confirm = () =>
    target &&
    void run(() => action(tenantSlug, { id: target.id }), {
      successMessage: t('deleted'),
      onSuccess: () => setTarget(null),
    });
  return { target, setTarget, confirm, pending };
}

// ----------------------------------------------------------------------------
// Campos personalizados
// ----------------------------------------------------------------------------

export function ContactFieldsManager({
  tenantSlug,
  fields,
}: {
  tenantSlug: string;
  fields: ContactFieldDefinition[];
}) {
  const t = useTranslations();
  const { run, pending, fieldErrors } = useAction();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FieldType>('STRING');
  const deletion = useDeletion<ContactFieldDefinition>(tenantSlug, deleteContactFieldAction);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const options = String(form.get('options') ?? '')
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean);
    void run(
      () =>
        createContactFieldAction(tenantSlug, {
          key: String(form.get('key') ?? ''),
          label: String(form.get('label') ?? ''),
          type,
          options,
        }),
      { successMessage: t('Common.saved'), onSuccess: () => setOpen(false) },
    );
  };

  return (
    <>
      <CrudShell
        createLabel={t('Settings.newField')}
        emptyMessage={t('ContactForm.noCustomFields')}
        isEmpty={fields.length === 0}
        headers={[t('Settings.fieldLabel'), t('Settings.fieldKey'), t('Settings.fieldType')]}
        onCreate={() => setOpen(true)}
        rows={fields.map((field) => (
          <TableRow key={field.id}>
            <TableCell className="font-semibold">{field.label}</TableCell>
            <TableCell>
              <code>{field.key}</code>
            </TableCell>
            <TableCell>
              {t(`Settings.fieldTypes.${field.type}`)}
              {field.options.length > 0 ? (
                <div className="text-sm text-ink-muted">{field.options.join(', ')}</div>
              ) : null}
            </TableCell>
            <TableCell align="right">
              <Button color="error" size="small" onClick={() => deletion.setTarget(field)}>
                {t('Common.delete')}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      />
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <form onSubmit={submit} noValidate>
          <DialogTitle>{t('Settings.newField')}</DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            <TextField
              name="label"
              label={t('Settings.fieldLabel')}
              required
              autoFocus
              fullWidth
              margin="dense"
              error={Boolean(fieldErrors.label)}
            />
            <TextField
              name="key"
              label={t('Settings.fieldKey')}
              helperText={t('Settings.fieldKeyHint')}
              required
              fullWidth
              error={Boolean(fieldErrors.key)}
              slotProps={{ htmlInput: { pattern: '[a-z][a-z0-9_]*', maxLength: 40 } }}
            />
            <FormControl fullWidth>
              <InputLabel id="field-type">{t('Settings.fieldType')}</InputLabel>
              <Select
                labelId="field-type"
                label={t('Settings.fieldType')}
                value={type}
                onChange={(event) =>
                  setType(
                    FIELD_TYPES.find((candidate) => candidate === event.target.value) ?? 'STRING',
                  )
                }
              >
                {FIELD_TYPES.map((fieldType) => (
                  <MenuItem key={fieldType} value={fieldType}>
                    {t(`Settings.fieldTypes.${fieldType}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {type === 'SELECT' ? (
              <TextField
                name="options"
                label={t('Settings.fieldOptions')}
                multiline
                minRows={3}
                fullWidth
                error={Boolean(fieldErrors.options)}
              />
            ) : null}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>{t('Common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {t('Common.create')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('Common.deleteConfirmTitle')}
        body={t('Settings.deleteFieldBody')}
        pending={deletion.pending}
        onClose={() => deletion.setTarget(null)}
        onConfirm={deletion.confirm}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Etiquetas
// ----------------------------------------------------------------------------

export function TagsManager({ tenantSlug, tags }: { tenantSlug: string; tags: TagView[] }) {
  const t = useTranslations();
  const { run, pending, fieldErrors } = useAction();
  const [open, setOpen] = useState(false);
  const deletion = useDeletion<TagView>(tenantSlug, deleteTagAction);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        createTagSettingsAction(tenantSlug, {
          name: String(form.get('name') ?? ''),
          color: String(form.get('color') ?? '#005E7D'),
        }),
      { successMessage: t('Common.saved'), onSuccess: () => setOpen(false) },
    );
  };

  return (
    <>
      <CrudShell
        createLabel={t('Settings.newTag')}
        emptyMessage={t('Common.none')}
        isEmpty={tags.length === 0}
        headers={[t('Common.name')]}
        onCreate={() => setOpen(true)}
        rows={tags.map((tag) => (
          <TableRow key={tag.id}>
            <TableCell>
              <span className="inline-flex items-center gap-2">
                <svg aria-hidden width="14" height="14" viewBox="0 0 14 14">
                  <circle cx="7" cy="7" r="7" fill={tag.color ?? '#878785'} />
                </svg>
                {tag.name}
              </span>
            </TableCell>
            <TableCell align="right">
              <Button color="error" size="small" onClick={() => deletion.setTarget(tag)}>
                {t('Common.delete')}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      />
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <form onSubmit={submit} noValidate>
          <DialogTitle>{t('Settings.newTag')}</DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            <TextField
              name="name"
              label={t('Common.name')}
              required
              autoFocus
              fullWidth
              margin="dense"
              error={Boolean(fieldErrors.name)}
              slotProps={{ htmlInput: { maxLength: 40 } }}
            />
            <TextField
              name="color"
              type="color"
              label={t('Settings.color')}
              defaultValue="#005E7D"
              fullWidth
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>{t('Common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {t('Common.create')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('Common.deleteConfirmTitle')}
        body={t('Common.deleteConfirmBody')}
        pending={deletion.pending}
        onClose={() => deletion.setTarget(null)}
        onConfirm={deletion.confirm}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Temas de suscripción
// ----------------------------------------------------------------------------

type TopicEditing = { mode: 'create' } | { mode: 'edit'; topic: TopicView } | null;

export function TopicsManager({ tenantSlug, topics }: { tenantSlug: string; topics: TopicView[] }) {
  const t = useTranslations();
  const { run, pending, fieldErrors } = useAction();
  const [editing, setEditing] = useState<TopicEditing>(null);
  const deletion = useDeletion<TopicView>(tenantSlug, deleteTopicAction);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const topic = {
      name: { es: String(form.get('nameEs') ?? ''), en: String(form.get('nameEn') ?? '') },
      description: {},
      isDefault: form.get('isDefault') === 'on',
    };
    const action =
      editing?.mode === 'edit'
        ? () => updateTopicAction(tenantSlug, { id: editing.topic.id, topic })
        : () => createTopicAction(tenantSlug, { ...topic, key: String(form.get('key') ?? '') });
    void run(action, { successMessage: t('Common.saved'), onSuccess: () => setEditing(null) });
  };

  const current = editing?.mode === 'edit' ? editing.topic : null;

  return (
    <>
      <CrudShell
        createLabel={t('Settings.newTopic')}
        emptyMessage={t('Common.none')}
        isEmpty={topics.length === 0}
        headers={[t('Common.name'), t('Settings.fieldKey'), t('Settings.topicDefault')]}
        onCreate={() => setEditing({ mode: 'create' })}
        rows={topics.map((topic) => (
          <TableRow key={topic.id}>
            <TableCell>
              <div className="font-semibold">{topic.name.es}</div>
              <div className="text-sm text-ink-muted">{topic.name.en}</div>
            </TableCell>
            <TableCell>
              <code>{topic.key}</code>
            </TableCell>
            <TableCell>
              <StatusChip
                label={topic.isDefault ? t('Common.yes') : t('Common.no')}
                tone={topic.isDefault ? 'success' : 'default'}
              />
            </TableCell>
            <TableCell align="right">
              <Button size="small" onClick={() => setEditing({ mode: 'edit', topic })}>
                {t('Common.edit')}
              </Button>
              <Button color="error" size="small" onClick={() => deletion.setTarget(topic)}>
                {t('Common.delete')}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      />
      <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <form onSubmit={submit} noValidate key={current?.id ?? 'new'}>
          <DialogTitle>{current ? t('Settings.editTopic') : t('Settings.newTopic')}</DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            {current ? null : (
              <TextField
                name="key"
                label={t('Settings.fieldKey')}
                helperText={t('Settings.fieldKeyHint')}
                required
                fullWidth
                margin="dense"
                error={Boolean(fieldErrors.key)}
                slotProps={{ htmlInput: { maxLength: 40 } }}
              />
            )}
            <TextField
              name="nameEs"
              label={t('Settings.topicNameEs')}
              defaultValue={current?.name.es ?? ''}
              required
              fullWidth
            />
            <TextField
              name="nameEn"
              label={t('Settings.topicNameEn')}
              defaultValue={current?.name.en ?? ''}
              required
              fullWidth
            />
            <FormControlLabel
              control={<Switch name="isDefault" defaultChecked={current?.isDefault ?? true} />}
              label={t('Settings.topicDefault')}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditing(null)}>{t('Common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {t('Common.save')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <ConfirmDialog
        open={deletion.target !== null}
        title={t('Common.deleteConfirmTitle')}
        body={t('Common.deleteConfirmBody')}
        pending={deletion.pending}
        onClose={() => deletion.setTarget(null)}
        onConfirm={deletion.confirm}
      />
    </>
  );
}
