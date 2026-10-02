/**
 * Claves de API por tenant para integraciones (p. ej. MCSupport sincroniza sus clientes).
 * Formato `mcsn_{prefijo}_{secreto}`: el prefijo identifica la clave en la UI y en los logs;
 * solo se guarda el SHA-256 de la clave completa, que se muestra una única vez al crearla.
 */
import { z } from 'zod';
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import { actorUserId, type TenantContext } from '@/core/shared/tenant-context';
import { API_SCOPES, type ApiScope } from './api-scopes';

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface ApiKeyLookup extends ApiKeyView {
  tenantId: string;
  tenantSlug: string;
  tenantActive: boolean;
}

export interface ApiKeyRepository {
  create(
    context: TenantContext,
    input: Pick<ApiKeyView, 'name' | 'prefix' | 'scopes' | 'expiresAt'> & {
      keyHash: string;
      createdById: string;
    },
  ): Promise<ApiKeyView>;
  list(context: TenantContext): Promise<ApiKeyView[]>;
  revoke(context: TenantContext, apiKeyId: string, at: Date): Promise<boolean>;
  findByHash(keyHash: string): Promise<ApiKeyLookup | null>;
  touch(apiKeyId: string, at: Date): Promise<void>;
}

/** Generación y verificación de claves (implementación criptográfica en infraestructura). */
export interface ApiKeyCodec {
  generate(): { key: string; prefix: string; hash: string };
  /** Devuelve el hash si el formato es válido; null si no lo es (sin consultar la base de datos). */
  hash(key: string): string | null;
}

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(730).nullable(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

export class ManageApiKeysUseCase {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly codec: ApiKeyCodec,
    private readonly audit: AuditLogger,
    private readonly clock: Clock,
  ) {}

  list(context: TenantContext) {
    assertCan(context, 'apikey:manage');
    return this.keys.list(context);
  }

  async create(context: TenantContext, input: z.infer<typeof createApiKeySchema>) {
    assertCan(context, 'apikey:manage');
    const userId = actorUserId(context);
    if (!userId) throw new DomainError('FORBIDDEN', 'Solo un usuario puede crear claves de API');

    const { key, prefix, hash } = this.codec.generate();
    const expiresAt = input.expiresInDays
      ? new Date(this.clock.now().getTime() + input.expiresInDays * DAY_MS)
      : null;
    const apiKey = await this.keys.create(context, {
      name: input.name,
      prefix,
      scopes: [...new Set(input.scopes)],
      expiresAt,
      keyHash: hash,
      createdById: userId,
    });
    await this.audit.record(context, {
      action: 'apikey.created',
      entityType: 'api_key',
      entityId: apiKey.id,
      metadata: { prefix, scopes: apiKey.scopes, expiresAt: expiresAt?.toISOString() ?? null },
    });
    return { apiKey, key };
  }

  async revoke(context: TenantContext, apiKeyId: string) {
    assertCan(context, 'apikey:manage');
    if (!(await this.keys.revoke(context, apiKeyId, this.clock.now()))) {
      throw new DomainError('NOT_FOUND', 'Clave inexistente o ya revocada');
    }
    await this.audit.record(context, {
      action: 'apikey.revoked',
      entityType: 'api_key',
      entityId: apiKeyId,
    });
  }
}

/** Autentica una petición de la API pública y devuelve su contexto de tenant. */
export class AuthenticateApiKeyUseCase {
  constructor(
    private readonly keys: ApiKeyRepository,
    private readonly codec: ApiKeyCodec,
    private readonly clock: Clock,
  ) {}

  async execute(rawKey: string): Promise<TenantContext> {
    const hash = this.codec.hash(rawKey);
    const apiKey = hash ? await this.keys.findByHash(hash) : null;
    const now = this.clock.now();
    if (
      !apiKey ||
      apiKey.revokedAt ||
      !apiKey.tenantActive ||
      (apiKey.expiresAt && apiKey.expiresAt <= now)
    ) {
      throw new DomainError('UNAUTHENTICATED', 'Clave de API inválida');
    }
    await this.keys.touch(apiKey.id, now);
    return {
      tenantId: apiKey.tenantId,
      tenantSlug: apiKey.tenantSlug,
      actor: { type: 'apiKey', apiKeyId: apiKey.id, scopes: apiKey.scopes },
    };
  }
}
