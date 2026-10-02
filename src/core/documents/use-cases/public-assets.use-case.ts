/**
 * Recursos públicos de los correos (miniaturas, descargas y logotipo) resueltos a partir de una
 * URL firmada. La firma ya garantiza el tenant y el recurso; aquí se comprueba que siga existiendo
 * y que el documento esté listo. Se ejecuta con un contexto de sistema acotado a ese tenant.
 */
import { DomainError } from '@/core/shared/domain-error';
import type { ByteStream, ObjectStorage } from '@/core/shared/ports';
import { systemContext } from '@/core/shared/tenant-context';
import { isTenantLogoKey } from '@/core/tenants/branding.use-cases';
import type { DocumentRepository } from '../ports';
import { openDocumentFile, type DocumentFile } from './documents.use-cases';

export class ResolvePublicAssetUseCase {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async document(
    tenantId: string,
    documentId: string,
    variant: 'thumbnail' | 'original',
  ): Promise<DocumentFile> {
    const context = systemContext(tenantId, '', 'public-asset');
    const record = await this.documents.findById(context, documentId);
    if (record?.status !== 'READY') throw new DomainError('NOT_FOUND', 'Recurso inexistente');
    return openDocumentFile(this.storage, record, variant);
  }

  async logo(tenantId: string, logoKey: string): Promise<ByteStream> {
    if (!isTenantLogoKey(tenantId, logoKey)) {
      throw new DomainError('NOT_FOUND', 'Recurso inexistente');
    }
    return this.storage.getStream(logoKey);
  }
}
