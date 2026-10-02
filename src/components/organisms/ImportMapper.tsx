'use client';

/** Mapeo de columnas del archivo a campos de contacto y opciones de la importación. */
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { configureImportAction } from '@/app/_server/actions/imports.actions';
import { useAction } from '@/common/hooks/use-action';
import { useRouter } from '@/common/i18n/navigation';

interface ImportMapperProps {
  tenantSlug: string;
  importId: string;
  headers: string[];
  previewRows: string[][];
  suggestedMapping: Record<string, string>;
  fields: Array<{ key: string; label: string }>;
  lists: Array<{ id: string; name: string }>;
}

const STANDARD_TARGETS = [
  { value: 'email', label: 'Contacts.email' },
  { value: 'firstName', label: 'Contacts.firstName' },
  { value: 'lastName', label: 'Contacts.lastName' },
  { value: 'company', label: 'Contacts.company' },
  { value: 'locale', label: 'ContactForm.locale' },
  { value: 'timezone', label: 'ContactForm.timezone' },
  { value: 'externalId', label: 'ContactForm.externalId' },
] as const;

export function ImportMapper({
  tenantSlug,
  importId,
  headers,
  previewRows,
  suggestedMapping,
  fields,
  lists,
}: ImportMapperProps) {
  const t = useTranslations();
  const router = useRouter();
  const { run, pending } = useAction();
  const [mapping, setMapping] = useState<Record<string, string>>(suggestedMapping);
  const [duplicatePolicy, setDuplicatePolicy] = useState<'UPDATE' | 'SKIP'>('UPDATE');
  const [listId, setListId] = useState('');
  const [consentSource, setConsentSource] = useState('');

  const targets = Object.values(mapping).filter((target) => target !== 'ignore');
  const hasEmail = targets.includes('email');
  const hasDuplicates = new Set(targets).size !== targets.length;

  const sample = (columnIndex: number) =>
    previewRows.map((row) => row[columnIndex] ?? '').find((value) => value !== '') ?? '';

  const submit = () =>
    void run(
      () =>
        configureImportAction(tenantSlug, {
          importId,
          mapping,
          duplicatePolicy,
          listId: listId || null,
          consentSource,
        }),
      { onSuccess: () => router.refresh() },
    );

  return (
    <div className="flex flex-col gap-6">
      <TableContainer className="rounded-lg border border-line">
        <Table size="small" aria-label={t('Import.mappingTitle')}>
          <TableHead>
            <TableRow>
              <TableCell>{t('Import.column')}</TableCell>
              <TableCell>{t('Import.sample')}</TableCell>
              <TableCell className="w-72">{t('Import.target')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {headers.map((header, index) => (
              <TableRow key={header}>
                <TableCell className="font-medium">{header}</TableCell>
                <TableCell className="max-w-64 truncate text-ink-muted">{sample(index)}</TableCell>
                <TableCell>
                  <FormControl size="small" fullWidth>
                    <Select
                      aria-label={`${t('Import.target')}: ${header}`}
                      value={mapping[header] ?? 'ignore'}
                      onChange={(event) =>
                        setMapping((current) => ({ ...current, [header]: event.target.value }))
                      }
                    >
                      <MenuItem value="ignore">{t('Import.ignore')}</MenuItem>
                      {STANDARD_TARGETS.map((target) => (
                        <MenuItem key={target.value} value={target.value}>
                          {t(target.label)}
                        </MenuItem>
                      ))}
                      {fields.map((field) => (
                        <MenuItem key={field.key} value={`attr.${field.key}`}>
                          {field.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {!hasEmail ? (
        <Alert severity="warning">{t('Import.errors.EMAIL_COLUMN_REQUIRED')}</Alert>
      ) : null}
      {hasDuplicates ? (
        <Alert severity="warning">{t('Import.errors.DUPLICATE_TARGET')}</Alert>
      ) : null}

      <Card variant="outlined">
        <CardContent className="grid gap-6 md:grid-cols-2">
          <FormControl>
            <FormLabel id="duplicate-policy">{t('Import.duplicatePolicy')}</FormLabel>
            <RadioGroup
              aria-labelledby="duplicate-policy"
              value={duplicatePolicy}
              onChange={(event) =>
                setDuplicatePolicy(event.target.value === 'SKIP' ? 'SKIP' : 'UPDATE')
              }
            >
              <FormControlLabel
                value="UPDATE"
                control={<Radio />}
                label={t('Import.policyUpdate')}
              />
              <FormControlLabel value="SKIP" control={<Radio />} label={t('Import.policySkip')} />
            </RadioGroup>
          </FormControl>
          <div className="flex flex-col gap-4">
            <FormControl fullWidth>
              <InputLabel id="import-list">{t('Import.addToList')}</InputLabel>
              <Select
                labelId="import-list"
                label={t('Import.addToList')}
                value={listId}
                onChange={(event) => setListId(event.target.value)}
              >
                <MenuItem value="">{t('Import.noList')}</MenuItem>
                {lists.map((list) => (
                  <MenuItem key={list.id} value={list.id}>
                    {list.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label={t('Import.consentSource')}
              helperText={t('Import.consentHint')}
              value={consentSource}
              onChange={(event) => setConsentSource(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          </div>
        </CardContent>
      </Card>

      <div>
        <Button
          variant="contained"
          size="large"
          disabled={!hasEmail || hasDuplicates || pending}
          onClick={submit}
        >
          {t('Import.start')}
        </Button>
      </div>
    </div>
  );
}
