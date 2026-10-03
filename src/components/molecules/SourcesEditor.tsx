'use client';

/**
 * Editor de fuentes para la IA: texto, página web, feed RSS, documento de la biblioteca y
 * novedades del buzón. Lo comparten el diálogo de borrador y el editor de automatizaciones.
 */
import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutlined from '@mui/icons-material/DeleteOutlined';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { MAX_SOURCES, type DraftSource, type DraftSourceKind } from '@/core/ai/sources';

export interface SourceDocumentOption {
  id: string;
  title: string;
}

interface SourcesEditorProps {
  sources: DraftSource[];
  onChange: (sources: DraftSource[]) => void;
  documents: SourceDocumentOption[];
  /** Tipos disponibles (las automatizaciones suelen usar sobre todo novedades y feeds). */
  kinds?: readonly DraftSourceKind[];
  error?: string | undefined;
}

const ALL_KINDS: readonly DraftSourceKind[] = ['changelog', 'text', 'url', 'rss', 'document'];

function emptySource(kind: DraftSourceKind, documents: SourceDocumentOption[]): DraftSource {
  switch (kind) {
    case 'text':
      return { kind, title: '', text: '' };
    case 'url':
      return { kind, url: '' };
    case 'rss':
      return { kind, url: '', maxItems: 5 };
    case 'document':
      return { kind, documentId: documents[0]?.id ?? '' };
    case 'changelog':
      return { kind, days: 7, onlyNew: true };
  }
}

export function SourcesEditor({
  sources,
  onChange,
  documents,
  kinds = ALL_KINDS,
  error,
}: SourcesEditorProps) {
  const t = useTranslations('AiSources');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const update = (index: number, source: DraftSource) =>
    onChange(sources.map((item, position) => (position === index ? source : item)));
  const remove = (index: number) => onChange(sources.filter((_, position) => position !== index));

  const fields = (source: DraftSource, index: number) => {
    switch (source.kind) {
      case 'text':
        return (
          <>
            <TextField
              label={t('title')}
              value={source.title}
              onChange={(event) => update(index, { ...source, title: event.target.value })}
              fullWidth
              size="small"
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            <TextField
              label={t('text')}
              value={source.text}
              onChange={(event) => update(index, { ...source, text: event.target.value })}
              fullWidth
              multiline
              minRows={4}
              required
              helperText={t('textHint')}
              slotProps={{ htmlInput: { maxLength: 20_000 } }}
            />
          </>
        );
      case 'url':
        return (
          <TextField
            label={t('url')}
            type="url"
            value={source.url}
            onChange={(event) => update(index, { ...source, url: event.target.value })}
            fullWidth
            size="small"
            required
            helperText={t('urlHint')}
          />
        );
      case 'rss':
        return (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
            <TextField
              label={t('feedUrl')}
              type="url"
              value={source.url}
              onChange={(event) => update(index, { ...source, url: event.target.value })}
              size="small"
              required
            />
            <TextField
              label={t('maxItems')}
              type="number"
              value={source.maxItems}
              onChange={(event) =>
                update(index, { ...source, maxItems: Number(event.target.value) || 1 })
              }
              size="small"
              slotProps={{ htmlInput: { min: 1, max: 20 } }}
            />
          </div>
        );
      case 'document':
        return documents.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('noDocuments')}
          </Typography>
        ) : (
          <TextField
            select
            label={t('document')}
            value={source.documentId}
            onChange={(event) => update(index, { ...source, documentId: event.target.value })}
            size="small"
            fullWidth
          >
            {documents.map((document) => (
              <MenuItem key={document.id} value={document.id}>
                {document.title}
              </MenuItem>
            ))}
          </TextField>
        );
      case 'changelog':
        return (
          <div className="flex flex-wrap items-center gap-4">
            <TextField
              label={t('days')}
              type="number"
              value={source.days}
              onChange={(event) =>
                update(index, { ...source, days: Number(event.target.value) || 1 })
              }
              size="small"
              className="w-32"
              slotProps={{ htmlInput: { min: 1, max: 90 } }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={source.onlyNew}
                  onChange={(event) => update(index, { ...source, onlyNew: event.target.checked })}
                />
              }
              label={t('onlyNew')}
            />
          </div>
        );
    }
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">{t('legend')}</legend>
      {sources.map((source, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-lg border border-line p-3"
          aria-label={t(`kinds.${source.kind}`)}
          role="group"
        >
          <div className="flex items-center justify-between gap-2">
            <Typography variant="subtitle2">{t(`kinds.${source.kind}`)}</Typography>
            <IconButton
              size="small"
              aria-label={`${t('remove')}: ${t(`kinds.${source.kind}`)}`}
              onClick={() => remove(index)}
            >
              <DeleteOutlined fontSize="small" />
            </IconButton>
          </div>
          {fields(source, index)}
        </div>
      ))}
      {error ? (
        <Typography variant="body2" color="error" role="alert">
          {error}
        </Typography>
      ) : null}
      <div>
        <Button
          startIcon={<AddOutlined />}
          onClick={(event) => setAnchor(event.currentTarget)}
          disabled={sources.length >= MAX_SOURCES}
          aria-haspopup="menu"
        >
          {t('add')}
        </Button>
        <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
          {kinds.map((kind) => (
            <MenuItem
              key={kind}
              onClick={() => {
                onChange([...sources, emptySource(kind, documents)]);
                setAnchor(null);
              }}
            >
              {t(`kinds.${kind}`)}
            </MenuItem>
          ))}
        </Menu>
      </div>
    </fieldset>
  );
}
