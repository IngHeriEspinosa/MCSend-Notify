/** Repositorio de documentos (acotado al tenant con el cliente extendido). */
import type {
  DocumentQuery,
  DocumentRecord,
  DocumentStatus,
  DocumentSummary,
} from '@/core/documents/document';
import type { DocumentPatch, DocumentRepository, NewDocument } from '@/core/documents/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { TenantClientCache } from '../tenant-scope.extension';

const SUMMARY_SELECT = {
  id: true,
  title: true,
  fileName: true,
  extension: true,
  kind: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  error: true,
  pageCount: true,
  thumbnailKey: true,
  thumbnailWidth: true,
  thumbnailHeight: true,
  createdAt: true,
  processedAt: true,
} as const;

const RECORD_SELECT = {
  ...SUMMARY_SELECT,
  sha256: true,
  storageKey: true,
  pdfKey: true,
  extractedText: true,
  attempts: true,
  createdById: true,
} as const;

export class PrismaDocumentRepository implements DocumentRepository {
  constructor(private readonly clients: TenantClientCache) {}

  create(context: TenantContext, input: NewDocument): Promise<DocumentRecord> {
    return this.clients.forTenant(context.tenantId).document.create({
      data: { ...input, tenantId: context.tenantId },
      select: RECORD_SELECT,
    });
  }

  findById(context: TenantContext, documentId: string): Promise<DocumentRecord | null> {
    return this.clients
      .forTenant(context.tenantId)
      .document.findFirst({ where: { id: documentId }, select: RECORD_SELECT });
  }

  findManyByIds(
    context: TenantContext,
    documentIds: readonly string[],
  ): Promise<DocumentSummary[]> {
    if (documentIds.length === 0) return Promise.resolve([]);
    return this.clients
      .forTenant(context.tenantId)
      .document.findMany({ where: { id: { in: [...documentIds] } }, select: SUMMARY_SELECT });
  }

  list(context: TenantContext, query: DocumentQuery): Promise<DocumentSummary[]> {
    const search = query.search?.trim();
    return this.clients.forTenant(context.tenantId).document.findMany({
      where: {
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' as const } },
                { fileName: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: SUMMARY_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async update(context: TenantContext, documentId: string, patch: DocumentPatch): Promise<void> {
    await this.clients
      .forTenant(context.tenantId)
      .document.updateMany({ where: { id: documentId }, data: patch });
  }

  async transition(
    context: TenantContext,
    documentId: string,
    from: readonly DocumentStatus[],
    patch: DocumentPatch,
  ): Promise<boolean> {
    const { count } = await this.clients.forTenant(context.tenantId).document.updateMany({
      where: { id: documentId, status: { in: [...from] } },
      data: patch,
    });
    return count > 0;
  }

  async delete(context: TenantContext, documentId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .document.deleteMany({ where: { id: documentId } });
    return count > 0;
  }
}
