'use client';

/**
 * Editor de segmentos: constructor visual de reglas (grupos anidados AND/OR) con vista previa
 * del número de contactos. Las reglas se validan de nuevo en el servidor al contar y al guardar.
 */
import AddOutlined from '@mui/icons-material/AddOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createSegmentAction,
  previewSegmentCountAction,
  updateSegmentAction,
} from '@/app/_server/actions/audience.actions';
import { useAction } from '@/common/hooks/use-action';
import { Link, useRouter } from '@/common/i18n/navigation';
import { CONTACT_STATUSES, type ContactStatus } from '@/core/contacts/contact';
import type { ContactFieldDefinition } from '@/core/contacts/contact-fields';
import {
  ATTRIBUTE_FIELD_PREFIX,
  buildSegmentCatalog,
  isRuleSet,
  MAX_SEGMENT_DEPTH,
  OPERATORS_BY_KIND,
  type SegmentCatalog,
  type SegmentFieldDescriptor,
  type SegmentOperator,
  type SegmentRule,
  type SegmentRuleSet,
} from '@/core/contacts/segments';

interface Option {
  id: string;
  name: string;
}

interface SegmentEditorProps {
  tenantSlug: string;
  fields: ContactFieldDefinition[];
  lists: Option[];
  tags: Option[];
  segment?: { id: string; name: string; description: string | null; rules: SegmentRuleSet };
  canWrite: boolean;
}

const BUILTIN_FIELD_IDS = [
  'email',
  'firstName',
  'lastName',
  'company',
  'locale',
  'status',
  'createdAt',
  'lastEngagedAt',
  'list',
  'tag',
] as const;
const NO_VALUE: ReadonlySet<SegmentOperator> = new Set([
  'isEmpty',
  'isNotEmpty',
  'isTrue',
  'isFalse',
]);
const PREVIEW_DEBOUNCE_MS = 600;

function isContactStatus(value: string): value is ContactStatus {
  return (CONTACT_STATUSES as readonly string[]).includes(value);
}

const newRule = (): SegmentRule => ({ field: 'email', operator: 'contains', value: '' });

interface EditorContext {
  catalog: SegmentCatalog;
  fields: ContactFieldDefinition[];
  lists: Option[];
  tags: Option[];
  disabled: boolean;
  fieldLabel: (field: SegmentFieldDescriptor) => string;
}

function defaultValue(
  field: SegmentFieldDescriptor,
  operator: SegmentOperator,
): SegmentRule['value'] {
  if (NO_VALUE.has(operator)) return undefined;
  if (operator === 'in' || operator === 'notIn') return [];
  if (operator === 'inLastDays' || operator === 'notInLastDays') return 30;
  if (field.kind === 'number') return 0;
  return '';
}

function RuleEditor({
  rule,
  editor,
  onChange,
  onRemove,
}: {
  rule: SegmentRule;
  editor: EditorContext;
  onChange: (rule: SegmentRule) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('Segments');
  const tRoot = useTranslations();
  const field = editor.catalog.get(rule.field);

  const optionLabel = (descriptor: SegmentFieldDescriptor, option: string) => {
    if (descriptor.id === 'status' && isContactStatus(option))
      return tRoot(`ContactStatus.${option}`);
    if (descriptor.id === 'locale' && (option === 'es' || option === 'en'))
      return tRoot(`Common.languages.${option}`);
    return option;
  };
  const operators = field ? OPERATORS_BY_KIND[field.kind] : [];

  const changeField = (fieldId: string) => {
    const next = editor.catalog.get(fieldId);
    if (!next) return;
    const operator = OPERATORS_BY_KIND[next.kind][0] ?? 'equals';
    onChange({ field: fieldId, operator, value: defaultValue(next, operator) });
  };

  const changeOperator = (operator: SegmentOperator) =>
    field && onChange({ ...rule, operator, value: defaultValue(field, operator) });

  const renderValue = () => {
    if (!field || NO_VALUE.has(rule.operator)) return null;
    const label = t('value');
    if (field.kind === 'list' || field.kind === 'tag') {
      const options = field.kind === 'list' ? editor.lists : editor.tags;
      return (
        <FormControl size="small" className="min-w-48 flex-1">
          <InputLabel>{label}</InputLabel>
          <Select
            label={label}
            value={typeof rule.value === 'string' ? rule.value : ''}
            onChange={(event) => onChange({ ...rule, value: event.target.value })}
            disabled={editor.disabled}
          >
            {options.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }
    if (field.kind === 'select') {
      const multiple = rule.operator === 'in' || rule.operator === 'notIn';
      return (
        <FormControl size="small" className="min-w-48 flex-1">
          <InputLabel>{label}</InputLabel>
          <Select
            label={label}
            multiple={multiple}
            value={
              multiple
                ? Array.isArray(rule.value)
                  ? rule.value
                  : []
                : typeof rule.value === 'string'
                  ? rule.value
                  : ''
            }
            onChange={(event) => {
              const value = event.target.value;
              onChange({
                ...rule,
                value: multiple ? (Array.isArray(value) ? value : value.split(',')) : String(value),
              });
            }}
            renderValue={multiple ? (selected) => (selected as string[]).join(', ') : undefined}
            disabled={editor.disabled}
          >
            {(field.options ?? []).map((option) => (
              <MenuItem key={option} value={option}>
                {optionLabel(field, option)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }
    const isDays = rule.operator === 'inLastDays' || rule.operator === 'notInLastDays';
    const type =
      field.kind === 'number' || isDays ? 'number' : field.kind === 'date' ? 'date' : 'text';
    return (
      <TextField
        size="small"
        label={isDays ? t('days') : label}
        type={type}
        value={rule.value ?? ''}
        onChange={(event) =>
          onChange({
            ...rule,
            value: type === 'number' ? Number(event.target.value) : event.target.value,
          })
        }
        disabled={editor.disabled}
        className="min-w-48 flex-1"
        slotProps={type === 'date' ? { inputLabel: { shrink: true } } : undefined}
      />
    );
  };

  const builtin = BUILTIN_FIELD_IDS.map((id) => editor.catalog.get(id)).filter(
    (item): item is SegmentFieldDescriptor => item !== undefined,
  );
  const custom = [...editor.catalog.values()].filter((item) =>
    item.id.startsWith(ATTRIBUTE_FIELD_PREFIX),
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-paper p-3 sm:flex-row sm:flex-wrap sm:items-center">
      <FormControl size="small" className="min-w-44">
        <InputLabel>{t('field')}</InputLabel>
        <Select
          label={t('field')}
          value={rule.field}
          onChange={(event) => changeField(event.target.value)}
          disabled={editor.disabled}
        >
          {builtin.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {editor.fieldLabel(item)}
            </MenuItem>
          ))}
          {custom.length > 0 ? (
            <ListSubheader>{tRoot('ContactForm.customFields')}</ListSubheader>
          ) : null}
          {custom.map((item) => (
            <MenuItem key={item.id} value={item.id}>
              {editor.fieldLabel(item)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" className="min-w-52">
        <InputLabel>{t('operator')}</InputLabel>
        <Select
          label={t('operator')}
          value={rule.operator}
          onChange={(event) => {
            const operator = operators.find((candidate) => candidate === event.target.value);
            if (operator) changeOperator(operator);
          }}
          disabled={editor.disabled}
        >
          {operators.map((operator) => (
            <MenuItem key={operator} value={operator}>
              {t(`operators.${operator}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {renderValue()}
      {editor.disabled ? null : (
        <IconButton
          aria-label={t('removeRule')}
          onClick={onRemove}
          className="self-end sm:self-auto"
        >
          <CloseOutlined />
        </IconButton>
      )}
    </div>
  );
}

function GroupEditor({
  group,
  depth,
  editor,
  onChange,
  onRemove,
}: {
  group: SegmentRuleSet;
  depth: number;
  editor: EditorContext;
  onChange: (group: SegmentRuleSet) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations('Segments');
  const update = (index: number, node: SegmentRule | SegmentRuleSet) =>
    onChange({
      ...group,
      rules: group.rules.map((current, position) => (position === index ? node : current)),
    });
  const remove = (index: number) =>
    onChange({ ...group, rules: group.rules.filter((_, position) => position !== index) });

  return (
    <div
      className={`flex flex-col gap-3 ${depth > 1 ? 'rounded-xl border border-dashed border-primary p-3' : ''}`}
    >
      <div className="flex items-center gap-2">
        <FormControl size="small" className="min-w-64">
          <Select
            aria-label={t('rules')}
            value={group.combinator}
            onChange={(event) =>
              onChange({ ...group, combinator: event.target.value === 'or' ? 'or' : 'and' })
            }
            disabled={editor.disabled}
          >
            <MenuItem value="and">{t('matchAll')}</MenuItem>
            <MenuItem value="or">{t('matchAny')}</MenuItem>
          </Select>
        </FormControl>
        {onRemove && !editor.disabled ? (
          <IconButton aria-label={t('removeRule')} onClick={onRemove}>
            <CloseOutlined />
          </IconButton>
        ) : null}
      </div>
      {group.rules.map((node, index) =>
        isRuleSet(node) ? (
          <GroupEditor
            key={index}
            group={node}
            depth={depth + 1}
            editor={editor}
            onChange={(next) => update(index, next)}
            onRemove={() => remove(index)}
          />
        ) : (
          <RuleEditor
            key={index}
            rule={node}
            editor={editor}
            onChange={(next) => update(index, next)}
            onRemove={() => remove(index)}
          />
        ),
      )}
      {editor.disabled ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="small"
            startIcon={<AddOutlined />}
            onClick={() => onChange({ ...group, rules: [...group.rules, newRule()] })}
          >
            {t('addRule')}
          </Button>
          {depth < MAX_SEGMENT_DEPTH ? (
            <Button
              size="small"
              startIcon={<AddOutlined />}
              onClick={() =>
                onChange({
                  ...group,
                  rules: [...group.rules, { combinator: 'and', rules: [newRule()] }],
                })
              }
            >
              {t('addGroup')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function SegmentEditor({
  tenantSlug,
  fields,
  lists,
  tags,
  segment,
  canWrite,
}: SegmentEditorProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { run, pending, fieldErrors } = useAction();
  const [name, setName] = useState(segment?.name ?? '');
  const [description, setDescription] = useState(segment?.description ?? '');
  const [rules, setRules] = useState<SegmentRuleSet>(
    segment?.rules ?? { combinator: 'and', rules: [newRule()] },
  );
  const [count, setCount] = useState<number | null>(null);

  const catalog = useMemo(() => buildSegmentCatalog(fields), [fields]);
  const editor: EditorContext = {
    catalog,
    fields,
    lists,
    tags,
    disabled: !canWrite,
    fieldLabel: (field) =>
      field.attributeKey
        ? (fields.find((candidate) => candidate.key === field.attributeKey)?.label ??
          field.attributeKey)
        : t(`Segments.fields.${field.id as (typeof BUILTIN_FIELD_IDS)[number]}`),
  };

  useEffect(() => {
    const timer = setTimeout(async () => {
      const result = await previewSegmentCountAction(tenantSlug, { rules });
      setCount(result.ok ? result.data : null);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rules, tenantSlug]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = { name, description, rules };
    const action = segment
      ? () => updateSegmentAction(tenantSlug, { id: segment.id, segment: payload })
      : () => createSegmentAction(tenantSlug, payload);
    void run(action, {
      successMessage: t('Segments.saved'),
      onSuccess: () => router.push(`/t/${tenantSlug}/segments`),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <Card variant="outlined">
        <CardContent className="grid gap-4 md:grid-cols-2">
          <TextField
            label={t('Common.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={!canWrite}
            error={Boolean(fieldErrors.name)}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <TextField
            label={t('Common.description')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={!canWrite}
            slotProps={{ htmlInput: { maxLength: 300 } }}
          />
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Typography variant="h6" component="h2">
              {t('Segments.rules')}
            </Typography>
            <div aria-live="polite">
              {count === null ? (
                <Typography variant="body2" color="text.secondary">
                  {t('Segments.previewError')}
                </Typography>
              ) : (
                <Chip
                  color="primary"
                  label={t('Segments.preview', {
                    count: new Intl.NumberFormat(locale).format(count),
                  })}
                />
              )}
            </div>
          </div>
          <GroupEditor group={rules} depth={1} editor={editor} onChange={setRules} />
        </CardContent>
      </Card>

      {segment && count !== null && count > 0 ? (
        <Alert
          severity="info"
          action={
            <Button component={Link} href={`/t/${tenantSlug}/contacts?segmentId=${segment.id}`}>
              {t('Segments.viewContacts')}
            </Button>
          }
        >
          {t('Segments.preview', { count })}
        </Alert>
      ) : null}

      {canWrite ? (
        <div>
          <Button type="submit" variant="contained" size="large" disabled={pending}>
            {pending ? t('Common.saving') : t('Common.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
