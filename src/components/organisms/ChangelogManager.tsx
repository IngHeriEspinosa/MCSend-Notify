'use client';

/** Buzón de novedades: listado, alta manual, borrado y ejemplo de publicación por API. */
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
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
  deleteChangelogAction,
  publishChangelogAction,
} from '@/app/_server/actions/automations.actions';
import { useAction } from '@/common/hooks/use-action';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { CopyField } from '@/components/molecules/CopyField';
import { EmptyState } from '@/components/molecules/EmptyState';
import {
  CHANGELOG_CATEGORIES,
  type ChangelogCategory,
  type ChangelogEntryView,
} from '@/core/changelog/changelog';

interface ChangelogManagerProps {
  tenantSlug: string;
  entries: ChangelogEntryView[];
  canWrite: boolean;
  apiUrl: string;
  timeZone: string;
}

const CATEGORY_TONE: Record<
  ChangelogCategory,
  'primary' | 'success' | 'info' | 'error' | 'default'
> = {
  FEATURE: 'primary',
  IMPROVEMENT: 'info',
  FIX: 'success',
  SECURITY: 'error',
  OTHER: 'default',
};

export function ChangelogManager({
  tenantSlug,
  entries,
  canWrite,
  apiUrl,
  timeZone,
}: ChangelogManagerProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { run, pending, fieldErrors } = useAction();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ChangelogEntryView | null>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const category =
      CHANGELOG_CATEGORIES.find((item) => item === form.get('category')) ?? 'FEATURE';
    void run(
      () =>
        publishChangelogAction(tenantSlug, {
          title: String(form.get('title') ?? ''),
          version: String(form.get('version') ?? ''),
          bodyMd: String(form.get('bodyMd') ?? ''),
          category,
          externalId: '',
        }),
      { successMessage: t('Changelog.published'), onSuccess: () => setCreating(false) },
    );
  };

  const example = `curl -X POST ${apiUrl} -H "Authorization: Bearer mcsn_..." -H "Content-Type: application/json" -d '{"externalId":"release-3.2.0","version":"3.2.0","category":"FEATURE","title":"Panel de SLA","bodyMd":"..."}'`;

  return (
    <div className="flex flex-col gap-6">
      {canWrite ? (
        <div className="flex justify-end">
          <Button variant="contained" onClick={() => setCreating(true)}>
            {t('Changelog.new')}
          </Button>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState message={t('Changelog.empty')} />
      ) : (
        <TableContainer className="rounded-lg border border-line">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('Changelog.date')}</TableCell>
                <TableCell>{t('Changelog.entry')}</TableCell>
                <TableCell>{t('Changelog.category')}</TableCell>
                <TableCell>{t('Changelog.state')}</TableCell>
                {canWrite ? <TableCell align="right">{t('Common.actions')}</TableCell> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell className="whitespace-nowrap">
                    {dateFormat.format(entry.publishedAt)}
                  </TableCell>
                  <TableCell>
                    <Typography className="font-medium">
                      {entry.version ? `${entry.version} · ` : ''}
                      {entry.title}
                    </Typography>
                    {entry.bodyMd ? (
                      <Typography variant="body2" color="text.secondary" className="line-clamp-2">
                        {entry.bodyMd}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      label={t(`Changelog.categories.${entry.category}`)}
                      tone={CATEGORY_TONE[entry.category]}
                    />
                  </TableCell>
                  <TableCell>
                    {entry.consumedAt ? (
                      <StatusChip
                        label={t('Changelog.sent', { date: dateFormat.format(entry.consumedAt) })}
                        tone="success"
                      />
                    ) : (
                      <StatusChip label={t('Changelog.pending')} tone="warning" />
                    )}
                  </TableCell>
                  {canWrite ? (
                    <TableCell align="right">
                      <IconButton
                        aria-label={`${t('Common.delete')}: ${entry.title}`}
                        onClick={() => setDeleting(entry)}
                      >
                        <DeleteOutlined />
                      </IconButton>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Card variant="outlined" component="section" aria-labelledby="changelog-api">
        <CardContent className="flex flex-col gap-3">
          <Typography id="changelog-api" variant="h6" component="h2">
            {t('Changelog.apiTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('Changelog.apiHint')}
          </Typography>
          <CopyField label={t('Changelog.apiExample')} value={example} />
        </CardContent>
      </Card>

      <Dialog open={creating} onClose={() => setCreating(false)} fullWidth maxWidth="sm">
        <form onSubmit={submit} noValidate>
          <DialogTitle>{t('Changelog.new')}</DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            <TextField
              name="title"
              label={t('Changelog.title')}
              required
              autoFocus
              margin="dense"
              error={Boolean(fieldErrors.title)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                name="version"
                label={t('Changelog.version')}
                slotProps={{ htmlInput: { maxLength: 40 } }}
              />
              <TextField
                select
                name="category"
                label={t('Changelog.category')}
                defaultValue="FEATURE"
              >
                {CHANGELOG_CATEGORIES.map((category) => (
                  <MenuItem key={category} value={category}>
                    {t(`Changelog.categories.${category}`)}
                  </MenuItem>
                ))}
              </TextField>
            </div>
            <TextField
              name="bodyMd"
              label={t('Changelog.body')}
              multiline
              minRows={4}
              helperText={t('Changelog.bodyHint')}
              slotProps={{ htmlInput: { maxLength: 10_000 } }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreating(false)}>{t('Common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={pending}>
              {t('Changelog.publish')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={t('Changelog.deleteTitle')}
        body={t('Changelog.deleteBody')}
        confirmLabel={t('Common.delete')}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          void run(() => deleteChangelogAction(tenantSlug, { id: deleting.id }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => setDeleting(null),
          })
        }
      />
    </div>
  );
}
