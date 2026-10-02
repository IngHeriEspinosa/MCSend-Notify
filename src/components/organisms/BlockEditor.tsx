'use client';

/**
 * Editor de bloques de una plantilla: añadir, reordenar, duplicar, eliminar y editar cada bloque.
 * Cada bloque es un grupo de campos etiquetado (accesible por teclado y lector de pantalla);
 * el orden se cambia con botones, no solo arrastrando (WCAG 2.1.1).
 */
import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import {
  MAX_BLOCKS,
  MAX_COLUMN_BLOCKS,
  type ColumnBlock,
  type EmailBlock,
  type EmailBlockType,
} from '@/core/templates/email-content';
import type { DocumentKind } from '@/core/documents/document';

export interface DocumentOption {
  id: string;
  title: string;
  kind: DocumentKind;
}

const BLOCK_TYPES: readonly EmailBlockType[] = [
  'heading',
  'text',
  'button',
  'image',
  'document',
  'columns',
  'divider',
  'spacer',
];
const COLUMN_BLOCK_TYPES = ['heading', 'text', 'button', 'image'] as const;
type ColumnBlockType = (typeof COLUMN_BLOCK_TYPES)[number];

function newId(): string {
  return crypto.randomUUID();
}

function createColumnBlock(type: ColumnBlockType): ColumnBlock {
  switch (type) {
    case 'heading':
      return { id: newId(), type, text: '', level: 2, align: 'left' };
    case 'text':
      return { id: newId(), type, markdown: '' };
    case 'button':
      return { id: newId(), type, label: '', url: 'https://', align: 'center' };
    case 'image':
      return {
        id: newId(),
        type,
        src: 'https://',
        documentId: null,
        alt: '',
        href: null,
        width: 600,
        align: 'center',
      };
  }
}

export function createBlock(
  type: EmailBlockType,
  documents: readonly DocumentOption[],
): EmailBlock {
  switch (type) {
    case 'heading':
    case 'text':
    case 'button':
    case 'image':
      return createColumnBlock(type);
    case 'divider':
      return { id: newId(), type };
    case 'spacer':
      return { id: newId(), type, size: 'md' };
    case 'document':
      return {
        id: newId(),
        type,
        documentId: documents[0]?.id ?? '',
        title: null,
        description: null,
        buttonLabel: null,
      };
    case 'columns':
      return { id: newId(), type, left: [], right: [] };
  }
}

function withNewIds<T extends EmailBlock | ColumnBlock>(block: T): T {
  if (block.type === 'columns') {
    return {
      ...block,
      id: newId(),
      left: block.left.map(withNewIds),
      right: block.right.map(withNewIds),
    };
  }
  return { ...block, id: newId() };
}

const emptyToNull = (value: string): string | null => (value.trim() === '' ? null : value);

interface FieldsProps<T> {
  block: T;
  onChange: (block: T) => void;
  documents: readonly DocumentOption[];
  disabled: boolean;
}

function AlignField({
  value,
  onChange,
  disabled,
}: {
  value: 'left' | 'center';
  onChange: (value: 'left' | 'center') => void;
  disabled: boolean;
}) {
  const t = useTranslations('Blocks');
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      disabled={disabled}
      aria-label={t('align')}
      onChange={(_event, next: 'left' | 'center' | null) => next && onChange(next)}
    >
      <ToggleButton value="left">{t('alignLeft')}</ToggleButton>
      <ToggleButton value="center">{t('alignCenter')}</ToggleButton>
    </ToggleButtonGroup>
  );
}

function BlockFields({
  block,
  onChange,
  documents,
  disabled,
}: FieldsProps<EmailBlock | ColumnBlock>) {
  const t = useTranslations('Blocks');
  switch (block.type) {
    case 'heading':
      return (
        <div className="flex flex-col gap-3">
          <TextField
            label={t('headingText')}
            value={block.text}
            onChange={(event) => onChange({ ...block, text: event.target.value })}
            disabled={disabled}
            required
            fullWidth
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <div className="flex flex-wrap gap-3">
            <TextField
              select
              size="small"
              label={t('headingLevel')}
              value={block.level}
              onChange={(event) =>
                onChange({ ...block, level: event.target.value === '1' ? 1 : 2 })
              }
              disabled={disabled}
              className="w-44"
            >
              <MenuItem value={1}>{t('level1')}</MenuItem>
              <MenuItem value={2}>{t('level2')}</MenuItem>
            </TextField>
            <AlignField
              value={block.align}
              disabled={disabled}
              onChange={(align) => onChange({ ...block, align })}
            />
          </div>
        </div>
      );
    case 'text':
      return (
        <TextField
          label={t('markdown')}
          value={block.markdown}
          onChange={(event) => onChange({ ...block, markdown: event.target.value })}
          disabled={disabled}
          multiline
          minRows={4}
          fullWidth
          helperText={t('markdownHint')}
          slotProps={{ htmlInput: { maxLength: 20000 } }}
        />
      );
    case 'button':
      return (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <TextField
            label={t('buttonLabel')}
            value={block.label}
            onChange={(event) => onChange({ ...block, label: event.target.value })}
            disabled={disabled}
            required
            className="sm:w-56"
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <TextField
            label={t('url')}
            value={block.url}
            onChange={(event) => onChange({ ...block, url: event.target.value })}
            disabled={disabled}
            required
            className="sm:flex-1"
            helperText={t('urlHint')}
            slotProps={{ htmlInput: { maxLength: 2000, inputMode: 'url' } }}
          />
          <AlignField
            value={block.align}
            disabled={disabled}
            onChange={(align) => onChange({ ...block, align })}
          />
        </div>
      );
    case 'image': {
      const fromDocument = block.documentId !== null;
      const images = documents.filter((document) => document.kind === 'IMAGE');
      return (
        <div className="flex flex-col gap-3">
          <ToggleButtonGroup
            exclusive
            size="small"
            value={fromDocument ? 'document' : 'url'}
            disabled={disabled}
            aria-label={t('imageSource')}
            onChange={(_event, next: 'document' | 'url' | null) => {
              if (next === 'document') {
                onChange({ ...block, src: null, documentId: images[0]?.id ?? '' });
              } else if (next === 'url') {
                onChange({ ...block, src: 'https://', documentId: null });
              }
            }}
          >
            <ToggleButton value="url">{t('imageFromUrl')}</ToggleButton>
            <ToggleButton value="document" disabled={images.length === 0}>
              {t('imageFromLibrary')}
            </ToggleButton>
          </ToggleButtonGroup>
          {fromDocument ? (
            <TextField
              select
              label={t('image')}
              value={block.documentId ?? ''}
              onChange={(event) => onChange({ ...block, documentId: event.target.value })}
              disabled={disabled}
              fullWidth
            >
              {images.map((document) => (
                <MenuItem key={document.id} value={document.id}>
                  {document.title}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <TextField
              label={t('imageUrl')}
              value={block.src ?? ''}
              onChange={(event) => onChange({ ...block, src: event.target.value })}
              disabled={disabled}
              required
              fullWidth
              helperText={t('imageUrlHint')}
              slotProps={{ htmlInput: { maxLength: 2000, inputMode: 'url' } }}
            />
          )}
          <TextField
            label={t('alt')}
            value={block.alt}
            onChange={(event) => onChange({ ...block, alt: event.target.value })}
            disabled={disabled}
            required
            fullWidth
            helperText={t('altHint')}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <TextField
              label={t('imageLink')}
              value={block.href ?? ''}
              onChange={(event) => onChange({ ...block, href: emptyToNull(event.target.value) })}
              disabled={disabled}
              className="sm:flex-1"
              slotProps={{ htmlInput: { maxLength: 2000, inputMode: 'url' } }}
            />
            <TextField
              type="number"
              label={t('width')}
              value={block.width}
              onChange={(event) =>
                onChange({ ...block, width: Math.round(Number(event.target.value) || 600) })
              }
              disabled={disabled}
              className="sm:w-36"
              slotProps={{ htmlInput: { min: 80, max: 600, step: 10 } }}
            />
            <AlignField
              value={block.align}
              disabled={disabled}
              onChange={(align) => onChange({ ...block, align })}
            />
          </div>
        </div>
      );
    }
    case 'divider':
      return (
        <Typography variant="body2" color="text.secondary">
          {t('dividerHint')}
        </Typography>
      );
    case 'spacer':
      return (
        <TextField
          select
          size="small"
          label={t('spacerSize')}
          value={block.size}
          onChange={(event) =>
            onChange({ ...block, size: event.target.value as 'sm' | 'md' | 'lg' })
          }
          disabled={disabled}
          className="w-44"
        >
          <MenuItem value="sm">{t('sizes.sm')}</MenuItem>
          <MenuItem value="md">{t('sizes.md')}</MenuItem>
          <MenuItem value="lg">{t('sizes.lg')}</MenuItem>
        </TextField>
      );
    case 'document':
      return (
        <div className="flex flex-col gap-3">
          {documents.length === 0 ? (
            <Typography variant="body2" color="error">
              {t('noDocuments')}
            </Typography>
          ) : null}
          <TextField
            select
            label={t('document')}
            value={block.documentId}
            onChange={(event) => onChange({ ...block, documentId: event.target.value })}
            disabled={disabled || documents.length === 0}
            required
            fullWidth
          >
            {documents.map((document) => (
              <MenuItem key={document.id} value={document.id}>
                {document.title}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('documentTitle')}
            value={block.title ?? ''}
            onChange={(event) => onChange({ ...block, title: emptyToNull(event.target.value) })}
            disabled={disabled}
            fullWidth
            helperText={t('documentTitleHint')}
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <TextField
            label={t('documentDescription')}
            value={block.description ?? ''}
            onChange={(event) =>
              onChange({ ...block, description: emptyToNull(event.target.value) })
            }
            disabled={disabled}
            fullWidth
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />
          <TextField
            label={t('buttonLabel')}
            value={block.buttonLabel ?? ''}
            onChange={(event) =>
              onChange({ ...block, buttonLabel: emptyToNull(event.target.value) })
            }
            disabled={disabled}
            fullWidth
            helperText={t('documentButtonHint')}
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
        </div>
      );
    case 'columns':
      return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {(['left', 'right'] as const).map((side) => (
            <section key={side} aria-label={t(side === 'left' ? 'columnLeft' : 'columnRight')}>
              <Typography variant="subtitle2" className="mb-2">
                {t(side === 'left' ? 'columnLeft' : 'columnRight')}
              </Typography>
              <BlockList<ColumnBlock>
                blocks={block[side]}
                onChange={(next) => onChange({ ...block, [side]: next })}
                types={COLUMN_BLOCK_TYPES}
                create={(type) => createColumnBlock(type as ColumnBlockType)}
                max={MAX_COLUMN_BLOCKS}
                documents={documents}
                disabled={disabled}
                nested
              />
            </section>
          ))}
        </div>
      );
  }
}

interface BlockListProps<T extends EmailBlock | ColumnBlock> {
  blocks: T[];
  onChange: (blocks: T[]) => void;
  types: readonly EmailBlockType[];
  create: (type: EmailBlockType) => T;
  max: number;
  documents: readonly DocumentOption[];
  disabled: boolean;
  nested?: boolean;
}

function BlockList<T extends EmailBlock | ColumnBlock>({
  blocks,
  onChange,
  types,
  create,
  max,
  documents,
  disabled,
  nested = false,
}: BlockListProps<T>) {
  const t = useTranslations('Blocks');
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const replace = (index: number, block: T) =>
    onChange(blocks.map((item, position) => (position === index ? block : item)));
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    onChange(next);
  };
  const remove = (index: number) =>
    onChange(blocks.filter((_item, position) => position !== index));
  const duplicate = (index: number) => {
    const source = blocks[index];
    if (!source || blocks.length >= max) return;
    const next = [...blocks];
    next.splice(index + 1, 0, withNewIds(source));
    onChange(next);
  };

  const actions = (index: number, label: string): ReactNode => (
    <div className="flex">
      <IconButton
        size="small"
        aria-label={`${t('moveUp')}: ${label}`}
        disabled={disabled || index === 0}
        onClick={() => move(index, -1)}
      >
        <ArrowUpwardOutlined fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label={`${t('moveDown')}: ${label}`}
        disabled={disabled || index === blocks.length - 1}
        onClick={() => move(index, 1)}
      >
        <ArrowDownwardOutlined fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label={`${t('duplicate')}: ${label}`}
        disabled={disabled || blocks.length >= max}
        onClick={() => duplicate(index)}
      >
        <ContentCopyOutlined fontSize="small" />
      </IconButton>
      <IconButton
        size="small"
        aria-label={`${t('remove')}: ${label}`}
        disabled={disabled}
        onClick={() => remove(index)}
      >
        <DeleteOutlined fontSize="small" />
      </IconButton>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {blocks.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('empty')}
        </Typography>
      ) : null}
      <ol className="flex flex-col gap-3">
        {blocks.map((block, index) => {
          const label = `${t(`types.${block.type}`)} ${index + 1}`;
          return (
            <li key={block.id}>
              <fieldset
                className={`rounded-lg border border-line p-3 ${nested ? 'bg-surface' : 'bg-paper'}`}
              >
                <legend className="sr-only">{label}</legend>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Typography variant="subtitle2" component="p">
                    {label}
                  </Typography>
                  {actions(index, label)}
                </div>
                <BlockFields
                  block={block}
                  onChange={(next) => replace(index, next as T)}
                  documents={documents}
                  disabled={disabled}
                />
              </fieldset>
            </li>
          );
        })}
      </ol>
      <div>
        <Button
          startIcon={<AddOutlined />}
          variant={nested ? 'text' : 'outlined'}
          size={nested ? 'small' : 'medium'}
          disabled={disabled || blocks.length >= max}
          aria-haspopup="menu"
          onClick={(event) => setMenuAnchor(event.currentTarget)}
        >
          {t('add')}
        </Button>
        <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
          {types.map((type) => (
            <MenuItem
              key={type}
              disabled={type === 'document' && documents.length === 0}
              onClick={() => {
                onChange([...blocks, create(type)]);
                setMenuAnchor(null);
              }}
            >
              {t(`types.${type}`)}
            </MenuItem>
          ))}
        </Menu>
      </div>
    </div>
  );
}

interface BlockEditorProps {
  blocks: EmailBlock[];
  onChange: (blocks: EmailBlock[]) => void;
  documents: readonly DocumentOption[];
  disabled: boolean;
}

export function BlockEditor({ blocks, onChange, documents, disabled }: BlockEditorProps) {
  return (
    <BlockList<EmailBlock>
      blocks={blocks}
      onChange={onChange}
      types={BLOCK_TYPES}
      create={(type) => createBlock(type, documents)}
      max={MAX_BLOCKS}
      documents={documents}
      disabled={disabled}
    />
  );
}
