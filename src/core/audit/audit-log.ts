/**
 * Auditoría de acciones sensibles (OWASP A09). Cada caso de uso que cambia datos registra
 * quién, qué y sobre qué entidad; los metadatos nunca incluyen secretos.
 */
import { assertCan } from '@/core/identity/permissions';
import type { Page, PageRequest } from '@/core/shared/pagination';
import type { TenantContext } from '@/core/shared/tenant-context';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface AuditRecord extends AuditEntry {
  id: string;
  actorUserId: string | null;
  actorUserEmail: string | null;
  actorApiKeyId: string | null;
  ip: string | null;
  createdAt: Date;
}

export interface AuditLogger {
  /** `context` nulo = acción de plataforma (fuera de un tenant). */
  record(context: TenantContext | null, entry: AuditEntry): Promise<void>;
}

export interface AuditLogReader {
  list(context: TenantContext, page: PageRequest): Promise<Page<AuditRecord>>;
}

export class ListAuditLogUseCase {
  constructor(private readonly reader: AuditLogReader) {}

  execute(context: TenantContext, page: PageRequest): Promise<Page<AuditRecord>> {
    assertCan(context, 'audit:read');
    return this.reader.list(context, page);
  }
}
