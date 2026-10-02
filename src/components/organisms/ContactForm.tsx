'use client';

/** Formulario de alta y edición de contacto, con campos personalizados, listas, etiquetas y temas. */
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  createContactAction,
  deleteContactAction,
  updateContactAction,
} from '@/app/_server/actions/contacts.actions';
import type { ContactFormOptions } from '@/app/_server/contact-form-data';
import { useAction } from '@/common/hooks/use-action';
import { useRouter } from '@/common/i18n/navigation';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { CONTACT_STATUSES, type ContactDetail, type ContactStatus } from '@/core/contacts/contact';
import type { AttributeValue, ContactFieldDefinition } from '@/core/contacts/contact-fields';

interface ContactFormProps {
  tenantSlug: string;
  options: ContactFormOptions;
  contact?: ContactDetail;
  canWrite: boolean;
  canDelete: boolean;
}

type AttributeDraft = Record<string, string>;

const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

function toDraft(attributes: Record<string, AttributeValue> | undefined): AttributeDraft {
  return Object.fromEntries(
    Object.entries(attributes ?? {}).map(([key, value]) => [key, String(value)]),
  );
}

function fromDraft(
  fields: ContactFieldDefinition[],
  draft: AttributeDraft,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value = draft[field.key];
    if (value === undefined || value === '') continue;
    result[field.key] =
      field.type === 'NUMBER' ? Number(value) : field.type === 'BOOLEAN' ? value === 'true' : value;
  }
  return result;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card variant="outlined">
      <CardContent className="flex flex-col gap-4">
        <Typography variant="h6" component="h2">
          {title}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

export function ContactForm({
  tenantSlug,
  options,
  contact,
  canWrite,
  canDelete,
}: ContactFormProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [values, setValues] = useState({
    email: contact?.email ?? '',
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    company: contact?.company ?? '',
    locale: contact?.locale ?? '',
    timezone: contact?.timezone ?? '',
    externalId: contact?.externalId ?? '',
    status: (contact?.status ?? 'ACTIVE') as ContactStatus,
  });
  const [attributes, setAttributes] = useState<AttributeDraft>(toDraft(contact?.attributes));
  const [listIds, setListIds] = useState<string[]>(contact?.listIds ?? []);
  const [tagIds, setTagIds] = useState<string[]>(contact?.tagIds ?? []);
  const [topics, setTopics] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      options.topics.map((topic) => [
        topic.id,
        contact?.topicSubscriptions[topic.id] ?? topic.isDefault,
      ]),
    ),
  );

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const error = (key: string) => fieldErrors[key]?.[0];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = {
      email: values.email,
      firstName: values.firstName,
      lastName: values.lastName,
      company: values.company,
      locale: values.locale === '' ? null : values.locale,
      timezone: values.timezone,
      externalId: values.externalId,
      ...(contact ? { status: values.status } : {}),
      attributes: fromDraft(options.fields, attributes),
      listIds,
      tagIds,
      topicSubscriptions: topics,
    };
    if (contact) {
      void run(() => updateContactAction(tenantSlug, { id: contact.id, contact: payload }), {
        successMessage: t('Common.saved'),
      });
    } else {
      void run(() => createContactAction(tenantSlug, payload), {
        successMessage: t('ContactForm.created'),
        onSuccess: (data) => router.push(`/t/${tenantSlug}/contacts/${data.id}`),
      });
    }
  };

  const remove = () =>
    contact &&
    void run(() => deleteContactAction(tenantSlug, { id: contact.id }), {
      successMessage: t('Common.deleted'),
      onSuccess: () => router.push(`/t/${tenantSlug}/contacts`),
    });

  const renderField = (field: ContactFieldDefinition) => {
    const value = attributes[field.key] ?? '';
    const onChange = (next: string) =>
      setAttributes((current) => ({ ...current, [field.key]: next }));
    if (field.type === 'SELECT' || field.type === 'BOOLEAN') {
      const choices =
        field.type === 'BOOLEAN'
          ? [
              { value: 'true', label: t('Common.yes') },
              { value: 'false', label: t('Common.no') },
            ]
          : field.options.map((option) => ({ value: option, label: option }));
      return (
        <FormControl key={field.key} fullWidth disabled={!canWrite}>
          <InputLabel id={`attr-${field.key}`}>{field.label}</InputLabel>
          <Select
            labelId={`attr-${field.key}`}
            label={field.label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            <MenuItem value="">{t('ContactForm.booleanUnset')}</MenuItem>
            {choices.map((choice) => (
              <MenuItem key={choice.value} value={choice.value}>
                {choice.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }
    return (
      <TextField
        key={field.key}
        label={field.label}
        type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={!canWrite}
        fullWidth
        slotProps={field.type === 'DATE' ? { inputLabel: { shrink: true } } : undefined}
      />
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-6 lg:grid-cols-3" noValidate>
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Section title={t('ContactForm.identity')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('Contacts.email')}
              type="email"
              required
              value={values.email}
              onChange={(event) => set('email')(event.target.value)}
              error={Boolean(error('email'))}
              disabled={!canWrite}
              className="sm:col-span-2"
            />
            <TextField
              label={t('Contacts.firstName')}
              value={values.firstName}
              onChange={(event) => set('firstName')(event.target.value)}
              disabled={!canWrite}
            />
            <TextField
              label={t('Contacts.lastName')}
              value={values.lastName}
              onChange={(event) => set('lastName')(event.target.value)}
              disabled={!canWrite}
            />
            <TextField
              label={t('Contacts.company')}
              value={values.company}
              onChange={(event) => set('company')(event.target.value)}
              disabled={!canWrite}
            />
            <TextField
              label={t('ContactForm.externalId')}
              helperText={t('ContactForm.externalIdHint')}
              value={values.externalId}
              onChange={(event) => set('externalId')(event.target.value)}
              disabled={!canWrite}
            />
            <FormControl disabled={!canWrite}>
              <InputLabel id="contact-locale">{t('ContactForm.locale')}</InputLabel>
              <Select
                labelId="contact-locale"
                label={t('ContactForm.locale')}
                value={values.locale}
                onChange={(event) => set('locale')(event.target.value)}
              >
                <MenuItem value="">{t('Common.none')}</MenuItem>
                <MenuItem value="es">{t('Common.languages.es')}</MenuItem>
                <MenuItem value="en">{t('Common.languages.en')}</MenuItem>
              </Select>
            </FormControl>
            <Autocomplete
              options={TIMEZONES}
              value={values.timezone || null}
              onChange={(_event, next) => set('timezone')(next ?? '')}
              disabled={!canWrite}
              renderInput={(params) => <TextField {...params} label={t('ContactForm.timezone')} />}
            />
            {contact ? (
              <FormControl disabled={!canWrite}>
                <InputLabel id="contact-status">{t('Contacts.status')}</InputLabel>
                <Select
                  labelId="contact-status"
                  label={t('Contacts.status')}
                  value={values.status}
                  onChange={(event) => set('status')(event.target.value)}
                >
                  {CONTACT_STATUSES.map((status) => (
                    <MenuItem key={status} value={status}>
                      {t(`ContactStatus.${status}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
          </div>
        </Section>

        <Section title={t('ContactForm.customFields')}>
          {options.fields.length === 0 ? (
            <Typography color="text.secondary">{t('ContactForm.noCustomFields')}</Typography>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">{options.fields.map(renderField)}</div>
          )}
        </Section>
      </div>

      <div className="flex flex-col gap-6">
        <Section title={t('ContactForm.membership')}>
          <Autocomplete
            multiple
            options={options.lists}
            getOptionLabel={(option) => option.name}
            value={options.lists.filter((list) => listIds.includes(list.id))}
            onChange={(_event, next) => setListIds(next.map((list) => list.id))}
            disabled={!canWrite}
            renderInput={(params) => <TextField {...params} label={t('ContactForm.lists')} />}
          />
          <Autocomplete
            multiple
            options={options.tags}
            getOptionLabel={(option) => option.name}
            value={options.tags.filter((tag) => tagIds.includes(tag.id))}
            onChange={(_event, next) => setTagIds(next.map((tag) => tag.id))}
            disabled={!canWrite}
            renderInput={(params) => <TextField {...params} label={t('ContactForm.tags')} />}
          />
        </Section>

        {options.topics.length > 0 ? (
          <Section title={t('ContactForm.topics')}>
            {options.topics.map((topic) => (
              <FormControlLabel
                key={topic.id}
                control={
                  <Switch
                    checked={topics[topic.id] ?? topic.isDefault}
                    onChange={(event) =>
                      setTopics((current) => ({ ...current, [topic.id]: event.target.checked }))
                    }
                    disabled={!canWrite}
                  />
                }
                label={locale === 'en' ? topic.name.en : topic.name.es}
              />
            ))}
          </Section>
        ) : null}

        {contact ? (
          <Section title={t('ContactForm.consent')}>
            <Typography variant="body2" color="text.secondary">
              {contact.consentAt
                ? t('ContactForm.consentFrom', {
                    date: dateFormat.format(new Date(contact.consentAt)),
                    source: contact.consentSource ?? '-',
                  })
                : t('ContactForm.noConsent')}
            </Typography>
          </Section>
        ) : null}

        {canWrite ? (
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="contained" size="large" disabled={pending}>
              {pending ? t('Common.saving') : t('Common.save')}
            </Button>
            {contact && canDelete ? (
              <Button
                color="error"
                variant="outlined"
                size="large"
                onClick={() => setConfirmDelete(true)}
              >
                {t('Common.delete')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t('ContactForm.deleteTitle')}
        body={t('ContactForm.deleteBody')}
        pending={pending}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </form>
  );
}
