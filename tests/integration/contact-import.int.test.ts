/**
 * Importación de contactos de extremo a extremo contra PostgreSQL real:
 * semántica del upsert por lotes y rendimiento (DoD de la Fase 1: 10.000 filas en menos de 60 s).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContactImportQueue } from '@/core/contacts/ports';
import {
  ConfigureContactImportUseCase,
  ProcessContactImportUseCase,
  UploadContactImportUseCase,
  type ImportUseCaseDeps,
} from '@/core/contacts/use-cases/imports.use-cases';
import type { ByteStream, ObjectStorage } from '@/core/shared/ports';
import { systemClock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { cryptoIdGenerator } from '@/infrastructure/crypto/crypto-services';
import { PapaXlsxSpreadsheetReader } from '@/infrastructure/import/spreadsheet-reader';
import {
  PrismaContactFieldRepository,
  PrismaContactImportRepository,
  PrismaContactListRepository,
} from '@/infrastructure/persistence/prisma/repositories/audience.prisma-repositories';
import { PrismaContactRepository } from '@/infrastructure/persistence/prisma/repositories/contact.prisma-repository';
import { RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import { createTestPrisma, createTestTenant } from './helpers';

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, body: Uint8Array | ByteStream) {
    if (!(body instanceof Uint8Array)) throw new Error('Solo Uint8Array en tests');
    this.objects.set(key, body);
  }
  async getStream(key: string): Promise<ByteStream> {
    const bytes = await this.getBytes(key);
    return (async function* () {
      yield bytes;
    })();
  }
  async getBytes(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error(`No existe ${key}`);
    return bytes;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

const { prisma, clients } = createTestPrisma();
const contacts = new PrismaContactRepository(prisma, clients);
const storage = new MemoryStorage();
const queued: string[] = [];
const queue: ContactImportQueue = {
  enqueue: async (_context, importId) => void queued.push(importId),
};

const deps: ImportUseCaseDeps = {
  imports: new PrismaContactImportRepository(clients),
  contacts,
  lists: new PrismaContactListRepository(clients),
  fields: new PrismaContactFieldRepository(clients),
  storage,
  reader: new PapaXlsxSpreadsheetReader(),
  queue,
  audit: new RecordingAuditLogger(),
  clock: systemClock,
  ids: cryptoIdGenerator,
};

afterAll(async () => {
  await prisma.$disconnect();
});

describe('upsertBatch', () => {
  let context: TenantContext;

  beforeAll(async () => {
    context = await createTestTenant(prisma, 'upsert');
  });

  it('crea, actualiza fusionando atributos y no reactiva contactos dados de baja', async () => {
    const first = await contacts.upsertBatch(
      context,
      [
        {
          email: 'a@x.com',
          emailNormalized: 'a@x.com',
          firstName: 'Ana',
          attributes: { plan: 'Pyme', seats: 5 },
        },
        { email: 'b@x.com', emailNormalized: 'b@x.com', attributes: {} },
      ],
      'UPDATE',
    );
    expect(first).toMatchObject({ created: 2, updated: 0, skipped: 0 });
    await prisma.contact.updateMany({
      where: { tenantId: context.tenantId, emailNormalized: 'b@x.com' },
      data: { status: 'UNSUBSCRIBED' },
    });

    const second = await contacts.upsertBatch(
      context,
      [
        {
          email: 'a@x.com',
          emailNormalized: 'a@x.com',
          firstName: null,
          lastName: 'Pérez',
          attributes: { seats: 9 },
        },
        { email: 'B@X.com', emailNormalized: 'b@x.com', firstName: 'Bea', attributes: {} },
      ],
      'UPDATE',
    );
    expect(second).toMatchObject({ created: 0, updated: 2 });

    const ana = await prisma.contact.findFirstOrThrow({
      where: { tenantId: context.tenantId, emailNormalized: 'a@x.com' },
    });
    expect(ana).toMatchObject({
      firstName: 'Ana',
      lastName: 'Pérez',
      attributes: { plan: 'Pyme', seats: 9 },
    });
    const bea = await prisma.contact.findFirstOrThrow({
      where: { tenantId: context.tenantId, emailNormalized: 'b@x.com' },
    });
    expect(bea.status).toBe('UNSUBSCRIBED');
  });

  it('con política SKIP no modifica existentes pero devuelve sus ids', async () => {
    const result = await contacts.upsertBatch(
      context,
      [
        { email: 'a@x.com', emailNormalized: 'a@x.com', firstName: 'Otro', attributes: {} },
        { email: 'c@x.com', emailNormalized: 'c@x.com', attributes: {} },
      ],
      'SKIP',
    );
    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 1 });
    expect(result.contactIds).toHaveLength(2);
    const ana = await prisma.contact.findFirstOrThrow({
      where: { tenantId: context.tenantId, emailNormalized: 'a@x.com' },
    });
    expect(ana.firstName).toBe('Ana');
  });

  it('descarta un externalId que ya pertenece a otro contacto sin romper el lote', async () => {
    await contacts.upsertBatch(
      context,
      [{ email: 'd@x.com', emailNormalized: 'd@x.com', externalId: 'EXT-1', attributes: {} }],
      'UPDATE',
    );
    const result = await contacts.upsertBatch(
      context,
      [
        { email: 'e@x.com', emailNormalized: 'e@x.com', externalId: 'EXT-1', attributes: {} },
        { email: 'f@x.com', emailNormalized: 'f@x.com', externalId: 'EXT-2', attributes: {} },
      ],
      'UPDATE',
    );
    expect(result.created).toBe(2);
    const e = await prisma.contact.findFirstOrThrow({
      where: { tenantId: context.tenantId, emailNormalized: 'e@x.com' },
    });
    expect(e.externalId).toBeNull();
  });
});

describe('importación completa', () => {
  it('importa 10.000 filas con errores, duplicados y lista en menos de 60 s', async () => {
    const context = await createTestTenant(prisma, 'import');
    await deps.fields.create(context, {
      key: 'country',
      label: 'País',
      type: 'SELECT',
      options: ['DO', 'GT'],
    });
    const list = await deps.lists.create(context, { name: 'Importados', description: null });

    const lines = ['Correo;Nombre;País;Notas'];
    for (let index = 0; index < 10_000; index += 1) {
      const email = index % 1000 === 999 ? 'no-es-un-email' : `cliente${index}@empresa.com`;
      lines.push(`${email};Cliente ${index};${index % 2 === 0 ? 'DO' : 'gt'};nota`);
    }
    lines.push('cliente0@empresa.com;Duplicado;DO;');
    const bytes = new TextEncoder().encode(lines.join('\n'));

    const started = performance.now();
    const upload = await new UploadContactImportUseCase(deps).execute(context, {
      fileName: 'clientes.csv',
      bytes,
    });
    expect(upload.headers).toEqual(['Correo', 'Nombre', 'País', 'Notas']);

    await new ConfigureContactImportUseCase(deps).execute(context, {
      importId: upload.id,
      mapping: { Correo: 'email', Nombre: 'firstName', País: 'attr.country', Notas: 'ignore' },
      duplicatePolicy: 'UPDATE',
      listId: list.id,
      consentSource: 'Migración CRM',
    });
    expect(queued).toContain(upload.id);

    await new ProcessContactImportUseCase(deps).execute(
      {
        tenantId: context.tenantId,
        tenantSlug: context.tenantSlug,
        actor: { type: 'system', reason: 'test' },
      },
      upload.id,
    );
    const elapsedMs = performance.now() - started;

    const record = await deps.imports.findById(context, upload.id);
    expect(record).toMatchObject({
      status: 'COMPLETED',
      totalRows: 10_001,
      createdCount: 9_990,
      invalidCount: 10,
      skippedCount: 1,
    });
    expect(record?.errorReportKey).toBeTruthy();
    const report = new TextDecoder().decode(await storage.getBytes(record?.errorReportKey ?? ''));
    expect(report.split('\n')).toHaveLength(11);
    expect(report).toContain('EMAIL_INVALID');

    expect((await deps.lists.findById(context, list.id))?.memberCount).toBe(9_990);
    const sample = await prisma.contact.findFirstOrThrow({
      where: { tenantId: context.tenantId, emailNormalized: 'cliente1@empresa.com' },
    });
    expect(sample).toMatchObject({
      source: 'import',
      consentSource: 'Migración CRM',
      attributes: { country: 'GT' },
    });
    expect(elapsedMs).toBeLessThan(60_000);
    console.info(`Importación de 10.000 filas: ${Math.round(elapsedMs)} ms`);
  });
});
