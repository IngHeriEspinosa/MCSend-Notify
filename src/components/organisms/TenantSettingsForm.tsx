'use client';

/** Configuración general del tenant: nombre, idioma, zona horaria y dirección postal. */
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { updateTenantSettingsAction } from '@/app/_server/actions/settings.actions';
import { useAction } from '@/common/hooks/use-action';

const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

interface TenantSettingsFormProps {
  tenantSlug: string;
  initial: { name: string; defaultLocale: string; timezone: string; postalAddress: string | null };
  canUpdate: boolean;
}

export function TenantSettingsForm({ tenantSlug, initial, canUpdate }: TenantSettingsFormProps) {
  const t = useTranslations();
  const { run, pending, fieldErrors } = useAction();
  const [values, setValues] = useState({ ...initial, postalAddress: initial.postalAddress ?? '' });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(
      () =>
        updateTenantSettingsAction(tenantSlug, {
          ...values,
          postalAddress: values.postalAddress.trim() === '' ? null : values.postalAddress,
        }),
      { successMessage: t('Common.saved') },
    );
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
          <TextField
            label={t('Settings.tenantName')}
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            required
            disabled={!canUpdate}
            error={Boolean(fieldErrors.name)}
          />
          <FormControl disabled={!canUpdate}>
            <InputLabel id="tenant-locale">{t('Admin.defaultLocale')}</InputLabel>
            <Select
              labelId="tenant-locale"
              label={t('Admin.defaultLocale')}
              value={values.defaultLocale}
              onChange={(event) => setValues({ ...values, defaultLocale: event.target.value })}
            >
              <MenuItem value="es">{t('Common.languages.es')}</MenuItem>
              <MenuItem value="en">{t('Common.languages.en')}</MenuItem>
            </Select>
          </FormControl>
          <Autocomplete
            options={TIMEZONES}
            value={values.timezone}
            disableClearable
            onChange={(_event, timezone) => setValues({ ...values, timezone })}
            disabled={!canUpdate}
            renderInput={(params) => <TextField {...params} label={t('Admin.timezone')} />}
          />
          <TextField
            label={t('Settings.postalAddress')}
            helperText={t('Settings.postalAddressHint')}
            value={values.postalAddress}
            onChange={(event) => setValues({ ...values, postalAddress: event.target.value })}
            disabled={!canUpdate}
            multiline
            minRows={2}
            className="md:col-span-2"
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />
          {canUpdate ? (
            <div className="md:col-span-2">
              <Button type="submit" variant="contained" disabled={pending}>
                {pending ? t('Common.saving') : t('Common.save')}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
