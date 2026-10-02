'use client';

/** Administración de plataforma: alta de aplicaciones (tenants). */
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { createTenantAction } from '@/app/_server/actions/settings.actions';
import { useAction } from '@/common/hooks/use-action';
import { Link, useRouter } from '@/common/i18n/navigation';
import { StatusChip } from '@/components/atoms/StatusChip';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  defaultLocale: string;
}

export function TenantsAdmin({ tenants }: { tenants: TenantRow[] }) {
  const t = useTranslations();
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const [open, setOpen] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        createTenantAction({
          name: String(form.get('name') ?? ''),
          slug: String(form.get('slug') ?? ''),
          defaultLocale: String(form.get('defaultLocale') ?? 'es'),
        }),
      {
        successMessage: t('Admin.created'),
        onSuccess: (data) => router.push(`/t/${data.slug}/settings/general`),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="contained" onClick={() => setOpen(true)}>
          {t('Admin.newTenant')}
        </Button>
      </div>
      <TableContainer className="rounded-lg border border-line">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('Common.name')}</TableCell>
              <TableCell>{t('Admin.slug')}</TableCell>
              <TableCell>{t('Admin.status')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tenants.map((tenant) => (
              <TableRow key={tenant.id} hover>
                <TableCell>
                  <Link
                    href={`/t/${tenant.slug}/dashboard`}
                    className="font-medium text-primary hover:underline"
                  >
                    {tenant.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <code>{tenant.slug}</code>
                </TableCell>
                <TableCell>
                  <StatusChip
                    label={tenant.status}
                    tone={tenant.status === 'ACTIVE' ? 'success' : 'warning'}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <form onSubmit={submit} noValidate>
          <DialogTitle>{t('Admin.newTenant')}</DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            <TextField
              name="name"
              label={t('Common.name')}
              required
              autoFocus
              fullWidth
              margin="dense"
              error={Boolean(fieldErrors.name)}
            />
            <TextField
              name="slug"
              label={t('Admin.slug')}
              helperText={t('Admin.slugHint')}
              required
              fullWidth
              error={Boolean(fieldErrors.slug)}
              slotProps={{ htmlInput: { maxLength: 40 } }}
            />
            <FormControl fullWidth>
              <InputLabel id="tenant-default-locale">{t('Admin.defaultLocale')}</InputLabel>
              <Select
                labelId="tenant-default-locale"
                name="defaultLocale"
                label={t('Admin.defaultLocale')}
                defaultValue="es"
              >
                <MenuItem value="es">{t('Common.languages.es')}</MenuItem>
                <MenuItem value="en">{t('Common.languages.en')}</MenuItem>
              </Select>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>{t('Common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {t('Common.create')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </div>
  );
}
