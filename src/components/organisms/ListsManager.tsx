'use client';

/** Tabla de listas con alta, edición y borrado en diálogos. */
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import {
  createListAction,
  deleteListAction,
  updateListAction,
} from '@/app/_server/actions/audience.actions';
import { useAction } from '@/common/hooks/use-action';
import { Link } from '@/common/i18n/navigation';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import type { ContactListView } from '@/core/contacts/ports';

interface ListsManagerProps {
  tenantSlug: string;
  lists: ContactListView[];
  canWrite: boolean;
}

type Editing = { mode: 'create' } | { mode: 'edit'; list: ContactListView } | null;

export function ListsManager({ tenantSlug, lists, canWrite }: ListsManagerProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { run, pending, fieldErrors } = useAction();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<ContactListView | null>(null);
  const numberFormat = new Intl.NumberFormat(locale);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const list = {
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
    };
    const action =
      editing?.mode === 'edit'
        ? () => updateListAction(tenantSlug, { id: editing.list.id, list })
        : () => createListAction(tenantSlug, list);
    void run(action, { successMessage: t('Common.saved'), onSuccess: () => setEditing(null) });
  };

  return (
    <>
      {canWrite ? (
        <div className="mb-4 flex justify-end">
          <Button variant="contained" onClick={() => setEditing({ mode: 'create' })}>
            {t('Lists.new')}
          </Button>
        </div>
      ) : null}

      {lists.length === 0 ? (
        <EmptyState message={t('Lists.empty')} />
      ) : (
        <TableContainer className="rounded-lg border border-line">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('Common.name')}</TableCell>
                <TableCell>{t('Common.description')}</TableCell>
                <TableCell align="right">{t('Lists.members')}</TableCell>
                <TableCell align="right">{t('Common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lists.map((list) => (
                <TableRow key={list.id} hover>
                  <TableCell>
                    <Link
                      href={`/t/${tenantSlug}/lists/${list.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {list.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-ink-muted">{list.description}</TableCell>
                  <TableCell align="right">{numberFormat.format(list.memberCount)}</TableCell>
                  <TableCell align="right">
                    {canWrite ? (
                      <>
                        <IconButton
                          aria-label={`${t('Common.edit')}: ${list.name}`}
                          onClick={() => setEditing({ mode: 'edit', list })}
                        >
                          <EditOutlined />
                        </IconButton>
                        <IconButton
                          aria-label={`${t('Common.delete')}: ${list.name}`}
                          onClick={() => setDeleting(list)}
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

      <Dialog open={editing !== null} onClose={() => setEditing(null)} fullWidth maxWidth="sm">
        <form onSubmit={submit} noValidate>
          <DialogTitle>
            {editing?.mode === 'edit' ? t('Lists.editTitle') : t('Lists.new')}
          </DialogTitle>
          <DialogContent className="flex flex-col gap-4 pt-2">
            <TextField
              name="name"
              label={t('Common.name')}
              defaultValue={editing?.mode === 'edit' ? editing.list.name : ''}
              required
              autoFocus
              fullWidth
              margin="dense"
              error={Boolean(fieldErrors.name)}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <TextField
              name="description"
              label={t('Common.description')}
              defaultValue={editing?.mode === 'edit' ? (editing.list.description ?? '') : ''}
              multiline
              minRows={2}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 300 } }}
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
        open={deleting !== null}
        title={t('Common.deleteConfirmTitle')}
        body={t('Common.deleteConfirmBody')}
        pending={pending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          void run(() => deleteListAction(tenantSlug, { id: deleting.id }), {
            successMessage: t('Common.deleted'),
            onSuccess: () => setDeleting(null),
          })
        }
      />
    </>
  );
}
