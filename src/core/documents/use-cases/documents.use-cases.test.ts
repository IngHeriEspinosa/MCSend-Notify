import { beforeEach, describe, expect, it } from 'vitest';
import {
  FakeDocumentConverter,
  FakeFileInspector,
  FakeImageProcessor,
  FakePdfToolkit,
  InMemoryDocumentRepository,
  InMemoryObjectStorage,
  RecordingDocumentQueue,
} from '@tests/fakes/content.fakes';
import { FakeClock, RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import { DomainError } from '@/core/shared/domain-error';
import type { TenantContext } from '@/core/shared/tenant-context';
import { DocumentProcessingError, MAX_DOCUMENT_BYTES } from '../document';
import {
  ManageDocumentsUseCase,
  ProcessDocumentUseCase,
  UploadDocumentUseCase,
  type DocumentUseCaseDeps,
} from './documents.use-cases';

const TENANT = '11111111-1111-7111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-7222-8222-222222222222';

function userContext(role: 'EDITOR' | 'VIEWER' = 'EDITOR', tenantId = TENANT): TenantContext {
  return {
    tenantId,
    tenantSlug: 'mcsupport',
    actor: { type: 'user', userId: 'user-1', role, isPlatformAdmin: false },
  };
}

const systemCtx: TenantContext = {
  tenantId: TENANT,
  tenantSlug: 'mcsupport',
  actor: { type: 'system', reason: 'test' },
};

let deps: DocumentUseCaseDeps & {
  documents: InMemoryDocumentRepository;
  storage: InMemoryObjectStorage;
  converter: FakeDocumentConverter;
  queue: RecordingDocumentQueue;
};
let sequence = 0;

beforeEach(() => {
  sequence = 0;
  deps = {
    documents: new InMemoryDocumentRepository(),
    storage: new InMemoryObjectStorage(),
    inspector: new FakeFileInspector({
      pptx: {
        kind: 'PRESENTATION',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extension: 'pptx',
      },
      pdf: { kind: 'PDF', mimeType: 'application/pdf', extension: 'pdf' },
      png: { kind: 'IMAGE', mimeType: 'image/png', extension: 'png' },
      md: { kind: 'MARKDOWN', mimeType: 'text/markdown', extension: 'md' },
    }),
    converter: new FakeDocumentConverter(),
    pdf: new FakePdfToolkit(),
    images: new FakeImageProcessor(),
    queue: new RecordingDocumentQueue(),
    hasher: { sha256: () => 'a'.repeat(64) },
    audit: new RecordingAuditLogger(),
    clock: new FakeClock(),
    ids: {
      uuid: () => {
        sequence += 1;
        return `00000000-0000-7000-8000-${String(sequence).padStart(12, '0')}`;
      },
    },
  };
});

const bytes = (text: string) => new TextEncoder().encode(text);

async function upload(fileName: string, content = 'contenido') {
  return new UploadDocumentUseCase(deps).execute(userContext(), {
    fileName,
    bytes: bytes(content),
  });
}

describe('UploadDocumentUseCase', () => {
  it('guarda el original con una clave generada por el sistema, crea el registro y encola', async () => {
    const record = await upload('Novedades MCSupport 3.2.pptx');

    expect(record.title).toBe('Novedades MCSupport 3.2');
    expect(record.kind).toBe('PRESENTATION');
    expect(record.storageKey).toBe(`tenants/${TENANT}/documents/${record.id}/original.pptx`);
    expect(deps.storage.objects.has(record.storageKey)).toBe(true);
    expect(deps.queue.enqueued).toEqual([record.id]);
  });

  it('rechaza tipos no permitidos y archivos vacíos o demasiado grandes', async () => {
    await expect(upload('malware.exe')).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'FILE_TYPE' },
    });
    await expect(
      new UploadDocumentUseCase(deps).execute(userContext(), {
        fileName: 'vacio.pdf',
        bytes: new Uint8Array(),
      }),
    ).rejects.toMatchObject({ details: { reason: 'FILE_SIZE' } });
    await expect(
      new UploadDocumentUseCase(deps).execute(userContext(), {
        fileName: 'enorme.pdf',
        bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1),
      }),
    ).rejects.toMatchObject({ details: { reason: 'FILE_SIZE' } });
  });

  it('un VIEWER no puede subir documentos', async () => {
    await expect(
      new UploadDocumentUseCase(deps).execute(userContext('VIEWER'), {
        fileName: 'a.pdf',
        bytes: bytes('x'),
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('ProcessDocumentUseCase', () => {
  it('convierte una presentación a PDF, genera la miniatura y extrae el texto', async () => {
    const record = await upload('deck.pptx');
    await new ProcessDocumentUseCase(deps).execute(systemCtx, record.id, { finalAttempt: false });

    const processed = await deps.documents.findById(systemCtx, record.id);
    expect(processed).toMatchObject({
      status: 'READY',
      pageCount: 4,
      pdfKey: `tenants/${TENANT}/documents/${record.id}/document.pdf`,
      thumbnailKey: `tenants/${TENANT}/documents/${record.id}/thumbnail.jpg`,
      thumbnailWidth: 1200,
      extractedText: 'Texto extraído del PDF',
      attempts: 1,
      error: null,
    });
    expect(deps.converter.calls).toEqual([{ kind: 'PRESENTATION', extension: 'pptx' }]);
    expect(deps.storage.objects.has(processed?.thumbnailKey ?? '')).toBe(true);
  });

  it('un PDF no se convierte y una imagen solo genera miniatura', async () => {
    const pdf = await upload('informe.pdf');
    const image = await upload('foto.png');
    const process = new ProcessDocumentUseCase(deps);
    await process.execute(systemCtx, pdf.id, { finalAttempt: false });
    await process.execute(systemCtx, image.id, { finalAttempt: false });

    expect(deps.converter.calls).toEqual([]);
    expect(await deps.documents.findById(systemCtx, pdf.id)).toMatchObject({
      status: 'READY',
      pdfKey: null,
    });
    expect(await deps.documents.findById(systemCtx, image.id)).toMatchObject({
      status: 'READY',
      pageCount: 1,
      extractedText: null,
    });
  });

  it('el texto de Markdown se lee del original, no del PDF', async () => {
    const record = await upload('notas.md', '# Hola');
    await new ProcessDocumentUseCase(deps).execute(systemCtx, record.id, { finalAttempt: false });
    expect((await deps.documents.findById(systemCtx, record.id))?.extractedText).toBe(
      'texto: # Hola',
    );
  });

  it('un fallo intermedio se relanza para reintentar; el último intento deja FAILED con el código', async () => {
    const record = await upload('deck.pptx');
    deps.converter.failWith = new DocumentProcessingError('CONVERSION_FAILED', 'Gotenberg caído');
    const process = new ProcessDocumentUseCase(deps);

    await expect(process.execute(systemCtx, record.id, { finalAttempt: false })).rejects.toThrow();
    expect((await deps.documents.findById(systemCtx, record.id))?.status).toBe('PROCESSING');

    await expect(process.execute(systemCtx, record.id, { finalAttempt: true })).rejects.toThrow();
    expect(await deps.documents.findById(systemCtx, record.id)).toMatchObject({
      status: 'FAILED',
      error: 'CONVERSION_FAILED',
      attempts: 2,
    });
  });

  it('es idempotente: un documento listo no se vuelve a procesar', async () => {
    const record = await upload('deck.pptx');
    const process = new ProcessDocumentUseCase(deps);
    await process.execute(systemCtx, record.id, { finalAttempt: false });
    await process.execute(systemCtx, record.id, { finalAttempt: false });
    expect(deps.converter.calls).toHaveLength(1);
  });
});

describe('ManageDocumentsUseCase', () => {
  it('solo reintenta documentos fallidos y los vuelve a encolar', async () => {
    const record = await upload('deck.pptx');
    const manage = new ManageDocumentsUseCase(deps);
    await expect(manage.retry(userContext(), record.id)).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });

    await deps.documents.update(systemCtx, record.id, { status: 'FAILED', error: 'RENDER_FAILED' });
    await manage.retry(userContext(), record.id);
    expect(await deps.documents.findById(systemCtx, record.id)).toMatchObject({
      status: 'UPLOADED',
      error: null,
      attempts: 0,
    });
    expect(deps.queue.enqueued).toEqual([record.id, record.id]);
  });

  it('eliminar borra el registro y todos sus archivos', async () => {
    const record = await upload('deck.pptx');
    await new ProcessDocumentUseCase(deps).execute(systemCtx, record.id, { finalAttempt: false });
    expect(deps.storage.objects.size).toBe(3);

    await new ManageDocumentsUseCase(deps).delete(userContext(), record.id);
    expect(deps.storage.objects.size).toBe(0);
    expect(await deps.documents.findById(systemCtx, record.id)).toBeNull();
  });

  it('otro tenant no ve el documento (NOT_FOUND)', async () => {
    const record = await upload('deck.pptx');
    await expect(
      new ManageDocumentsUseCase(deps).get(userContext('EDITOR', OTHER_TENANT), record.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('el archivo original de la interfaz exige permiso de lectura y devuelve su tipo', async () => {
    const record = await upload('deck.pptx');
    const file = await new ManageDocumentsUseCase(deps).file(
      userContext('VIEWER'),
      record.id,
      'original',
    );
    expect(file.contentType).toContain('presentationml');
    await expect(
      new ManageDocumentsUseCase(deps).file(userContext('VIEWER'), record.id, 'thumbnail'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
