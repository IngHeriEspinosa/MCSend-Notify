/**
 * Importación de contactos desde CSV o XLSX en tres pasos:
 * 1. `UploadContactImportUseCase`: guarda el archivo y extrae cabeceras y vista previa.
 * 2. `ConfigureContactImportUseCase`: valida el mapeo de columnas y encola el procesamiento.
 * 3. `ProcessContactImportUseCase` (worker): recorre las filas por lotes, hace upsert,
 *    añade a la lista indicada y genera un informe CSV de errores.
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock, IdGenerator, ObjectStorage } from '@/core/shared/ports';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import type { ContactWriteData } from '../contact';
import { mapImportRow, suggestImportMapping, validateImportMapping } from '../import-mapping';
import type {
  ContactFieldRepository,
  ContactImportQueue,
  ContactImportRecord,
  ContactImportRepository,
  ContactListRepository,
  ContactRepository,
  ImportFileType,
  SpreadsheetReader,
} from '../ports';

export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 100_000;
export const IMPORT_BATCH_SIZE = 500;
const PREVIEW_ROWS = 20;

const CONTENT_TYPES: Record<ImportFileType, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Tipo real del archivo por su contenido (OWASP: no confiar en la extensión ni en el MIME declarado). */
export function detectImportFileType(fileName: string, bytes: Uint8Array): ImportFileType | null {
  const extension = fileName.toLowerCase().split('.').pop();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (extension === 'xlsx') return isZip ? 'xlsx' : null;
  if (extension === 'csv' || extension === 'txt') {
    const sample = bytes.subarray(0, 4096);
    return isZip || sample.includes(0) ? null : 'csv';
  }
  return null;
}

export interface ImportUseCaseDeps {
  imports: ContactImportRepository;
  contacts: ContactRepository;
  lists: ContactListRepository;
  fields: ContactFieldRepository;
  storage: ObjectStorage;
  reader: SpreadsheetReader;
  queue: ContactImportQueue;
  audit: AuditLogger;
  clock: Clock;
  ids: IdGenerator;
}

export class UploadContactImportUseCase {
  constructor(private readonly deps: ImportUseCaseDeps) {}

  async execute(context: TenantContext, input: { fileName: string; bytes: Uint8Array }) {
    assertCan(context, 'contact:import');
    const userId = actorUserId(context);
    if (!userId)
      throw new DomainError('FORBIDDEN', 'Solo un usuario puede importar desde la interfaz');
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
      throw new DomainError('VALIDATION', 'Tamaño de archivo no permitido', {
        reason: 'FILE_SIZE',
      });
    }
    const fileType = detectImportFileType(input.fileName, input.bytes);
    if (!fileType) {
      throw new DomainError('VALIDATION', 'Tipo de archivo no permitido', { reason: 'FILE_TYPE' });
    }

    const preview = await this.deps.reader.preview(input.bytes, fileType, PREVIEW_ROWS);
    if (preview.headers.length === 0) {
      throw new DomainError('VALIDATION', 'El archivo no tiene cabeceras', {
        reason: 'NO_HEADERS',
      });
    }

    const storageKey = `tenants/${context.tenantId}/imports/${this.deps.ids.uuid()}/source.${fileType}`;
    await this.deps.storage.put(storageKey, input.bytes, CONTENT_TYPES[fileType]);
    const record = await this.deps.imports.create(context, {
      fileName: input.fileName.slice(0, 200),
      fileType,
      storageKey,
      headers: preview.headers,
      previewRows: preview.rows,
      createdById: userId,
    });
    await this.deps.audit.record(context, {
      action: 'import.uploaded',
      entityType: 'contact_import',
      entityId: record.id,
      metadata: { fileType, bytes: input.bytes.byteLength },
    });
    return record;
  }
}

export const configureImportSchema = z.object({
  importId: z.uuid(),
  mapping: z.record(z.string().max(200), z.string().max(60)),
  duplicatePolicy: z.enum(['UPDATE', 'SKIP']),
  listId: z.uuid().nullable(),
  consentSource: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === '' ? null : value))
    .nullable(),
});

export class ConfigureContactImportUseCase {
  constructor(private readonly deps: ImportUseCaseDeps) {}

  async execute(context: TenantContext, input: z.infer<typeof configureImportSchema>) {
    assertCan(context, 'contact:import');
    const record = await this.deps.imports.findById(context, input.importId);
    if (!record) throw new DomainError('NOT_FOUND', 'Importación inexistente');
    if (record.status !== 'UPLOADED') {
      throw new DomainError('INVALID_STATE', 'La importación ya fue enviada a procesar');
    }
    const fields = await this.deps.fields.list(context);
    const errors = validateImportMapping(input.mapping, record.headers, fields);
    if (errors.length > 0) {
      throw new DomainError('VALIDATION', 'Mapeo de columnas inválido', { mapping: errors });
    }
    if (input.listId && (await this.deps.lists.countExisting(context, [input.listId])) !== 1) {
      throw new DomainError('VALIDATION', 'Lista inválida', { field: 'listId' });
    }

    await this.deps.imports.update(context, record.id, {
      status: 'QUEUED',
      mapping: input.mapping,
      duplicatePolicy: input.duplicatePolicy,
      listId: input.listId,
      consentSource: input.consentSource,
    });
    await this.deps.queue.enqueue(context, record.id);
    await this.deps.audit.record(context, {
      action: 'import.queued',
      entityType: 'contact_import',
      entityId: record.id,
      metadata: { duplicatePolicy: input.duplicatePolicy, listId: input.listId },
    });
  }
}

export class GetContactImportUseCase {
  constructor(private readonly deps: Pick<ImportUseCaseDeps, 'imports' | 'fields' | 'storage'>) {}

  async execute(context: TenantContext, importId: string) {
    assertCan(context, 'contact:import');
    const record = await this.deps.imports.findById(context, importId);
    if (!record) throw new DomainError('NOT_FOUND', 'Importación inexistente');
    const fields = await this.deps.fields.list(context);
    return {
      record,
      fields,
      suggestedMapping: record.mapping ?? suggestImportMapping(record.headers, fields),
    };
  }

  listRecent(context: TenantContext) {
    assertCan(context, 'contact:import');
    return this.deps.imports.listRecent(context, 20);
  }

  async errorReport(context: TenantContext, importId: string): Promise<Uint8Array> {
    const { record } = await this.execute(context, importId);
    if (!record.errorReportKey)
      throw new DomainError('NOT_FOUND', 'La importación no tiene errores');
    return this.deps.storage.getBytes(record.errorReportKey);
  }
}

function csvCell(value: string): string {
  // Neutraliza fórmulas al abrir el informe en Excel (CSV injection, OWASP).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

interface RowError {
  row: number;
  email: string;
  errors: string[];
}

export class ProcessContactImportUseCase {
  constructor(private readonly deps: ImportUseCaseDeps) {}

  async execute(context: TenantContext, importId: string): Promise<void> {
    const record = await this.deps.imports.findById(context, importId);
    if (
      !record ||
      record.status === 'COMPLETED' ||
      record.status === 'FAILED' ||
      record.status === 'UPLOADED'
    ) {
      return; // Idempotente: solo se procesa lo encolado (o lo interrumpido en PROCESSING).
    }
    if (!record.mapping) {
      await this.fail(context, importId, 'MAPPING_MISSING');
      return;
    }

    await this.deps.imports.update(context, importId, {
      status: 'PROCESSING',
      startedAt: this.deps.clock.now(),
    });
    try {
      const totals = await this.processRows(context, record, record.mapping);
      await this.deps.imports.update(context, importId, {
        ...totals,
        status: totals.error ? 'FAILED' : 'COMPLETED',
        finishedAt: this.deps.clock.now(),
      });
      await this.deps.audit.record(context, {
        action: 'import.completed',
        entityType: 'contact_import',
        entityId: importId,
        metadata: {
          totalRows: totals.totalRows,
          created: totals.createdCount,
          updated: totals.updatedCount,
          invalid: totals.invalidCount,
        },
      });
    } catch (error) {
      await this.fail(context, importId, 'PROCESSING_ERROR');
      throw error;
    }
  }

  private async processRows(
    context: TenantContext,
    record: ContactImportRecord,
    mapping: Record<string, string>,
  ) {
    const fields = await this.deps.fields.list(context);
    const consentAt = this.deps.clock.now();
    const seen = new Set<string>();
    const rowErrors: RowError[] = [];
    const totals = {
      totalRows: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      invalidCount: 0,
    };
    let batch: ContactWriteData[] = [];
    let error: string | null = null;

    const flush = async () => {
      if (batch.length === 0) return;
      const result = await this.deps.contacts.upsertBatch(context, batch, record.duplicatePolicy);
      totals.createdCount += result.created;
      totals.updatedCount += result.updated;
      totals.skippedCount += result.skipped;
      if (record.listId && result.contactIds.length > 0) {
        await this.deps.lists.addContacts(context, record.listId, result.contactIds, 'import');
      }
      batch = [];
      await this.deps.imports.update(context, record.id, totals);
    };

    const rows = this.deps.reader.readRows(
      await this.deps.storage.getStream(record.storageKey),
      record.fileType,
    );
    for await (const row of rows) {
      if (totals.totalRows >= MAX_IMPORT_ROWS) {
        error = 'TOO_MANY_ROWS';
        break;
      }
      totals.totalRows += 1;
      const mapped = mapImportRow(row, mapping, fields, {
        consentSource: record.consentSource,
        consentAt,
      });
      if (!mapped.ok) {
        totals.invalidCount += 1;
        rowErrors.push({
          row: totals.totalRows + 1,
          email: mapped.email ?? '',
          errors: mapped.errors,
        });
        continue;
      }
      if (seen.has(mapped.data.emailNormalized)) {
        totals.skippedCount += 1; // Duplicado dentro del mismo archivo: se conserva la primera fila.
        continue;
      }
      seen.add(mapped.data.emailNormalized);
      batch.push(mapped.data);
      if (batch.length >= IMPORT_BATCH_SIZE) await flush();
    }
    await flush();

    const errorReportKey =
      rowErrors.length > 0 ? await this.writeErrorReport(context, record, rowErrors) : null;
    return { ...totals, errorReportKey, error };
  }

  private async writeErrorReport(
    context: TenantContext,
    record: ContactImportRecord,
    rowErrors: RowError[],
  ) {
    const lines = ['"row","email","errors"'];
    for (const item of rowErrors) {
      lines.push([String(item.row), item.email, item.errors.join(' | ')].map(csvCell).join(','));
    }
    const key = `tenants/${context.tenantId}/imports/${record.id}/errors.csv`;
    await this.deps.storage.put(key, new TextEncoder().encode(lines.join('\n')), 'text/csv');
    return key;
  }

  private async fail(context: TenantContext, importId: string, error: string) {
    await this.deps.imports.update(context, importId, {
      status: 'FAILED',
      error,
      finishedAt: this.deps.clock.now(),
    });
  }
}
