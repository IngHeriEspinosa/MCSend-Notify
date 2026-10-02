'use client';

/**
 * Tabla de contactos con paginación, ordenación y filtros en el servidor (MUI X DataGrid).
 * Se reutiliza en el detalle de una lista (`fixedListId`) para gestionar sus miembros.
 */
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  DataGrid,
  type GridColDef,
  type GridPaginationModel,
  type GridRowSelectionModel,
  type GridSortModel,
} from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addContactsToListAction,
  listContactsAction,
  removeContactsFromListAction,
} from '@/app/_server/actions/contacts.actions';
import { useNotify } from '@/common/hooks/notifications';
import { useAction } from '@/common/hooks/use-action';
import { dataGridLocaleText } from '@/common/i18n/data-grid-locale';
import { Link } from '@/common/i18n/navigation';
import { StatusChip } from '@/components/atoms/StatusChip';
import {
  CONTACT_SORT_FIELDS,
  CONTACT_STATUSES,
  type ContactQuery,
  type ContactSummary,
} from '@/core/contacts/contact';
import type { Page } from '@/core/shared/pagination';

interface Option {
  id: string;
  name: string;
}

interface ContactsDataGridProps {
  tenantSlug: string;
  initialPage: Page<ContactSummary>;
  initialQuery: ContactQuery;
  lists: Option[];
  segments: Option[];
  canWrite: boolean;
  /** Muestra solo los contactos de esta lista y permite quitarlos. */
  fixedListId?: string;
}

const STATUS_TONE = {
  ACTIVE: 'success',
  UNSUBSCRIBED: 'default',
  BOUNCED: 'warning',
  COMPLAINED: 'error',
  INVALID: 'error',
} as const;

const SEARCH_DEBOUNCE_MS = 350;

function selectedIds(model: GridRowSelectionModel): string[] {
  return [...model.ids].map(String);
}

export function ContactsDataGrid({
  tenantSlug,
  initialPage,
  initialQuery,
  lists,
  segments,
  canWrite,
  fixedListId,
}: ContactsDataGridProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [query, setQuery] = useState<ContactQuery>(initialQuery);
  const [page, setPage] = useState(initialPage);
  const [search, setSearch] = useState(initialQuery.search ?? '');
  const [selection, setSelection] = useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set(),
  });
  const [targetList, setTargetList] = useState('');
  const { run, pending } = useAction();
  const notify = useNotify();
  const firstRender = useRef(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery((current) =>
        current.search === (search || undefined)
          ? current
          : { ...current, search: search || undefined, page: 0 },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void run(() => listContactsAction(tenantSlug, query), { onSuccess: setPage });
  }, [query, run, tenantSlug]);

  const reload = () => run(() => listContactsAction(tenantSlug, query), { onSuccess: setPage });

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );
  const ids = selectedIds(selection);

  const columns: GridColDef<ContactSummary>[] = [
    {
      field: 'email',
      headerName: t('Contacts.email'),
      flex: 1.4,
      minWidth: 220,
      renderCell: ({ row }) => (
        <Link
          href={`/t/${tenantSlug}/contacts/${row.id}`}
          className="font-medium text-primary hover:underline"
        >
          {row.email}
        </Link>
      ),
    },
    { field: 'firstName', headerName: t('Contacts.firstName'), flex: 1, minWidth: 130 },
    { field: 'lastName', headerName: t('Contacts.lastName'), flex: 1, minWidth: 130 },
    { field: 'company', headerName: t('Contacts.company'), flex: 1, minWidth: 150 },
    {
      field: 'status',
      headerName: t('Contacts.status'),
      sortable: false,
      minWidth: 130,
      renderCell: ({ row }) => (
        <StatusChip label={t(`ContactStatus.${row.status}`)} tone={STATUS_TONE[row.status]} />
      ),
    },
    {
      field: 'source',
      headerName: t('Contacts.source'),
      sortable: false,
      minWidth: 110,
      valueFormatter: (value: string) =>
        value === 'manual' || value === 'import' || value === 'api'
          ? t(`Contacts.sources.${value}`)
          : value,
    },
    {
      field: 'createdAt',
      headerName: t('Common.createdAt'),
      minWidth: 130,
      valueFormatter: (value: Date) => dateFormat.format(new Date(value)),
    },
  ];

  const onPagination = (model: GridPaginationModel) =>
    setQuery((current) => ({ ...current, page: model.page, pageSize: model.pageSize }));

  const onSort = (model: GridSortModel) => {
    const [first] = model;
    const field =
      CONTACT_SORT_FIELDS.find((candidate) => candidate === first?.field) ?? 'createdAt';
    setQuery((current) => ({
      ...current,
      sortField: field,
      sortDirection: first?.sort ?? 'desc',
      page: 0,
    }));
  };

  const clearSelection = () => setSelection({ type: 'include', ids: new Set() });

  const addToList = () =>
    void run(() => addContactsToListAction(tenantSlug, { listId: targetList, contactIds: ids }), {
      onSuccess: (count) => {
        notify(t('Contacts.addedToList', { count }));
        clearSelection();
        setTargetList('');
        void reload();
      },
    });

  const removeFromList = () => {
    if (!fixedListId) return;
    void run(
      () => removeContactsFromListAction(tenantSlug, { listId: fixedListId, contactIds: ids }),
      {
        onSuccess: (count) => {
          notify(t('Contacts.removedFromList', { count }));
          clearSelection();
          void reload();
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
        <TextField
          type="search"
          size="small"
          label={t('Common.search')}
          placeholder={t('Contacts.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="md:w-80"
        />
        <FormControl size="small" className="md:w-44">
          <InputLabel id="filter-status">{t('Contacts.status')}</InputLabel>
          <Select
            labelId="filter-status"
            label={t('Contacts.status')}
            value={query.status ?? ''}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                status: CONTACT_STATUSES.find((status) => status === event.target.value),
                page: 0,
              }))
            }
          >
            <MenuItem value="">{t('Common.all')}</MenuItem>
            {CONTACT_STATUSES.map((status) => (
              <MenuItem key={status} value={status}>
                {t(`ContactStatus.${status}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {fixedListId ? null : (
          <FormControl size="small" className="md:w-52">
            <InputLabel id="filter-list">{t('Contacts.list')}</InputLabel>
            <Select
              labelId="filter-list"
              label={t('Contacts.list')}
              value={query.listId ?? ''}
              onChange={(event) =>
                setQuery((current) => ({
                  ...current,
                  listId: event.target.value || undefined,
                  page: 0,
                }))
              }
            >
              <MenuItem value="">{t('Common.all')}</MenuItem>
              {lists.map((list) => (
                <MenuItem key={list.id} value={list.id}>
                  {list.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControl size="small" className="md:w-52">
          <InputLabel id="filter-segment">{t('Contacts.segment')}</InputLabel>
          <Select
            labelId="filter-segment"
            label={t('Contacts.segment')}
            value={query.segmentId ?? ''}
            onChange={(event) =>
              setQuery((current) => ({
                ...current,
                segmentId: event.target.value || undefined,
                page: 0,
              }))
            }
          >
            <MenuItem value="">{t('Common.all')}</MenuItem>
            {segments.map((segment) => (
              <MenuItem key={segment.id} value={segment.id}>
                {segment.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </div>

      {canWrite && ids.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-paper p-3 sm:flex-row sm:items-center">
          <Typography variant="body2" className="font-semibold">
            {t('Contacts.selected', { count: ids.length })}
          </Typography>
          {fixedListId ? (
            <Button
              color="error"
              variant="outlined"
              size="small"
              disabled={pending}
              onClick={removeFromList}
            >
              {t('Contacts.removeFromList')}
            </Button>
          ) : (
            <>
              <FormControl size="small" className="sm:w-56">
                <InputLabel id="bulk-list">{t('Contacts.addToList')}</InputLabel>
                <Select
                  labelId="bulk-list"
                  label={t('Contacts.addToList')}
                  value={targetList}
                  onChange={(event) => setTargetList(event.target.value)}
                >
                  {lists.map((list) => (
                    <MenuItem key={list.id} value={list.id}>
                      {list.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                size="small"
                disabled={!targetList || pending}
                onClick={addToList}
              >
                {t('Contacts.addToList')}
              </Button>
            </>
          )}
        </div>
      ) : null}

      <div className="min-h-[420px] w-full">
        <DataGrid
          rows={page.items}
          columns={columns}
          rowCount={page.total}
          loading={pending}
          paginationMode="server"
          sortingMode="server"
          filterMode="server"
          paginationModel={{ page: query.page, pageSize: query.pageSize }}
          onPaginationModelChange={onPagination}
          pageSizeOptions={[25, 50, 100]}
          sortModel={[{ field: query.sortField, sort: query.sortDirection }]}
          onSortModelChange={onSort}
          checkboxSelection={canWrite}
          disableRowSelectionOnClick
          rowSelectionModel={selection}
          onRowSelectionModelChange={setSelection}
          disableColumnFilter
          localeText={{ ...dataGridLocaleText(locale), noRowsLabel: t('Contacts.empty') }}
          autoHeight
        />
      </div>
    </div>
  );
}
