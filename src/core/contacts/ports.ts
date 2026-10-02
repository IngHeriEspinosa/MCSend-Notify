/** Puertos del módulo de contactos y audiencias. */
import type { Page } from '@/core/shared/pagination';
import type { ByteStream } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { ContactDetail, ContactQuery, ContactSummary, ContactWriteData } from './contact';
import type { ContactFieldDefinition, CreateContactFieldInput } from './contact-fields';
import type { SegmentCatalog, SegmentRuleSet } from './segments';

export type DuplicatePolicy = 'UPDATE' | 'SKIP';

export interface ContactRelations {
  listIds?: string[] | undefined;
  tagIds?: string[] | undefined;
  topicSubscriptions?: Record<string, boolean> | undefined;
}

export interface ResolvedSegmentFilter {
  rules: SegmentRuleSet;
  catalog: SegmentCatalog;
  now: Date;
}

export interface UpsertBatchResult {
  created: number;
  updated: number;
  skipped: number;
  contactIds: string[];
}

export interface ContactRepository {
  list(
    context: TenantContext,
    query: Omit<ContactQuery, 'segmentId'>,
    segment?: ResolvedSegmentFilter,
  ): Promise<Page<ContactSummary>>;
  findById(context: TenantContext, contactId: string): Promise<ContactDetail | null>;
  findIdByEmail(context: TenantContext, emailNormalized: string): Promise<string | null>;
  /** Lanza CONFLICT si el email ya existe en el tenant. */
  create(
    context: TenantContext,
    data: ContactWriteData,
    relations: ContactRelations,
  ): Promise<ContactDetail>;
  update(
    context: TenantContext,
    contactId: string,
    data: ContactWriteData,
    relations: ContactRelations,
  ): Promise<ContactDetail>;
  delete(context: TenantContext, contactId: string): Promise<boolean>;
  /** Inserta o actualiza por email normalizado (una sola sentencia por lote). */
  upsertBatch(
    context: TenantContext,
    rows: ContactWriteData[],
    policy: DuplicatePolicy,
  ): Promise<UpsertBatchResult>;
  count(context: TenantContext, segment: ResolvedSegmentFilter): Promise<number>;
}

export interface ContactListView {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: Date;
}

export interface ContactListRepository {
  list(context: TenantContext): Promise<ContactListView[]>;
  findById(context: TenantContext, listId: string): Promise<ContactListView | null>;
  create(
    context: TenantContext,
    input: { name: string; description: string | null },
  ): Promise<ContactListView>;
  update(
    context: TenantContext,
    listId: string,
    input: { name: string; description: string | null },
  ): Promise<ContactListView>;
  delete(context: TenantContext, listId: string): Promise<boolean>;
  countExisting(context: TenantContext, listIds: readonly string[]): Promise<number>;
  addContacts(
    context: TenantContext,
    listId: string,
    contactIds: readonly string[],
    source: string,
  ): Promise<number>;
  removeContacts(
    context: TenantContext,
    listId: string,
    contactIds: readonly string[],
  ): Promise<number>;
}

export interface SegmentView {
  id: string;
  name: string;
  description: string | null;
  rules: SegmentRuleSet;
  lastCount: number | null;
  lastCountedAt: Date | null;
  updatedAt: Date;
}

export interface SegmentRepository {
  list(context: TenantContext): Promise<SegmentView[]>;
  findById(context: TenantContext, segmentId: string): Promise<SegmentView | null>;
  create(
    context: TenantContext,
    input: { name: string; description: string | null; rules: SegmentRuleSet },
  ): Promise<SegmentView>;
  update(
    context: TenantContext,
    segmentId: string,
    input: { name: string; description: string | null; rules: SegmentRuleSet },
  ): Promise<SegmentView>;
  delete(context: TenantContext, segmentId: string): Promise<boolean>;
  saveCount(context: TenantContext, segmentId: string, count: number, at: Date): Promise<void>;
}

export interface TagView {
  id: string;
  name: string;
  color: string | null;
}

export interface TagRepository {
  list(context: TenantContext): Promise<TagView[]>;
  create(context: TenantContext, input: { name: string; color: string | null }): Promise<TagView>;
  delete(context: TenantContext, tagId: string): Promise<boolean>;
  countExisting(context: TenantContext, tagIds: readonly string[]): Promise<number>;
}

export interface ContactFieldRepository {
  list(context: TenantContext): Promise<ContactFieldDefinition[]>;
  create(context: TenantContext, input: CreateContactFieldInput): Promise<ContactFieldDefinition>;
  delete(context: TenantContext, fieldId: string): Promise<boolean>;
}

export interface LocalizedText {
  es: string;
  en: string;
}

export interface TopicView {
  id: string;
  key: string;
  name: LocalizedText;
  description: Partial<LocalizedText>;
  isDefault: boolean;
}

export interface TopicRepository {
  list(context: TenantContext): Promise<TopicView[]>;
  create(context: TenantContext, input: Omit<TopicView, 'id'>): Promise<TopicView>;
  update(
    context: TenantContext,
    topicId: string,
    input: Omit<TopicView, 'id' | 'key'>,
  ): Promise<TopicView>;
  delete(context: TenantContext, topicId: string): Promise<boolean>;
  countExisting(context: TenantContext, topicIds: readonly string[]): Promise<number>;
}

// ----------------------------------------------------------------------------
// Importación
// ----------------------------------------------------------------------------

export type ImportFileType = 'csv' | 'xlsx';

export type ImportStatus = 'UPLOADED' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface ContactImportRecord {
  id: string;
  fileName: string;
  fileType: ImportFileType;
  storageKey: string;
  status: ImportStatus;
  headers: string[];
  previewRows: string[][];
  mapping: Record<string, string> | null;
  duplicatePolicy: DuplicatePolicy;
  listId: string | null;
  consentSource: string | null;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  invalidCount: number;
  errorReportKey: string | null;
  error: string | null;
  createdById: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export type ContactImportPatch = Partial<
  Pick<
    ContactImportRecord,
    | 'status'
    | 'mapping'
    | 'duplicatePolicy'
    | 'listId'
    | 'consentSource'
    | 'totalRows'
    | 'createdCount'
    | 'updatedCount'
    | 'skippedCount'
    | 'invalidCount'
    | 'errorReportKey'
    | 'error'
    | 'startedAt'
    | 'finishedAt'
  >
>;

export interface ContactImportRepository {
  create(
    context: TenantContext,
    input: Pick<
      ContactImportRecord,
      'fileName' | 'fileType' | 'storageKey' | 'headers' | 'previewRows' | 'createdById'
    >,
  ): Promise<ContactImportRecord>;
  findById(context: TenantContext, importId: string): Promise<ContactImportRecord | null>;
  listRecent(context: TenantContext, limit: number): Promise<ContactImportRecord[]>;
  update(context: TenantContext, importId: string, patch: ContactImportPatch): Promise<void>;
}

export interface SpreadsheetPreview {
  headers: string[];
  rows: string[][];
}

/** Lectura de CSV/XLSX: vista previa y recorrido fila a fila (cabecera → valor). */
export interface SpreadsheetReader {
  preview(
    bytes: Uint8Array,
    fileType: ImportFileType,
    maxRows: number,
  ): Promise<SpreadsheetPreview>;
  readRows(source: ByteStream, fileType: ImportFileType): AsyncIterable<Record<string, string>>;
}

export interface ContactImportQueue {
  enqueue(context: TenantContext, importId: string): Promise<void>;
}
