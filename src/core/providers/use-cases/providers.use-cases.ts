/**
 * Gestión de proveedores de correo y remitentes del tenant.
 * Las credenciales se cifran con AAD `tenant:email_provider:{id}` antes de persistirse y no se
 * devuelven nunca. "Probar conexión" verifica con el proveedor real y actualiza su estado.
 */
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock, IdGenerator, SecretCipher, SecretTokenService } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  parseProviderConnection,
  senderDomain,
  type ProviderInput,
  type SenderInput,
} from '../provider-config';
import type {
  DnsChecker,
  EmailProviderFactory,
  ProviderConfigRepository,
  SenderRepository,
} from '../ports';

export function providerCredentialsAad(tenantId: string, providerId: string): string {
  return `${tenantId}:email_provider:${providerId}`;
}

export interface ProviderUseCaseDeps {
  providers: ProviderConfigRepository;
  senders: SenderRepository;
  cipher: SecretCipher;
  factory: EmailProviderFactory;
  dns: DnsChecker;
  tokens: SecretTokenService;
  audit: AuditLogger;
  clock: Clock;
  ids: IdGenerator;
}

export class ManageProvidersUseCase {
  constructor(private readonly deps: ProviderUseCaseDeps) {}

  list(context: TenantContext) {
    assertCan(context, 'provider:manage');
    return this.deps.providers.list(context);
  }

  async get(context: TenantContext, providerId: string) {
    assertCan(context, 'provider:manage');
    const provider = await this.deps.providers.findById(context, providerId);
    if (!provider) throw new DomainError('NOT_FOUND', 'Proveedor inexistente');
    const { credentialsEnc: _secret, ...view } = provider;
    return view;
  }

  async create(context: TenantContext, input: ProviderInput) {
    assertCan(context, 'provider:manage');
    if (!input.credentials) {
      throw new DomainError('VALIDATION', 'Faltan las credenciales', { field: 'credentials' });
    }
    const id = this.deps.ids.uuid();
    const provider = await this.deps.providers.create(
      context,
      id,
      this.deps.tokens.generate().token,
      {
        name: input.name,
        kind: input.kind,
        settings: input.settings,
        credentialsEnc: this.encrypt(context, id, input.credentials),
        rateLimitPerSecond: input.rateLimitPerSecond,
        maxPerDay: input.maxPerDay,
        isDefault: input.isDefault,
      },
    );
    await this.deps.audit.record(context, {
      action: 'provider.created',
      entityType: 'email_provider',
      entityId: provider.id,
      metadata: { kind: input.kind },
    });
    return provider;
  }

  async update(context: TenantContext, providerId: string, input: ProviderInput) {
    assertCan(context, 'provider:manage');
    const current = await this.deps.providers.findById(context, providerId);
    if (!current) throw new DomainError('NOT_FOUND', 'Proveedor inexistente');
    if (current.kind !== input.kind) {
      throw new DomainError('VALIDATION', 'No se puede cambiar el tipo de proveedor', {
        field: 'kind',
      });
    }
    const credentialsEnc = input.credentials
      ? this.encrypt(context, providerId, input.credentials)
      : current.credentialsEnc;
    const provider = await this.deps.providers.update(context, providerId, {
      name: input.name,
      kind: input.kind,
      settings: input.settings,
      credentialsEnc,
      rateLimitPerSecond: input.rateLimitPerSecond,
      maxPerDay: input.maxPerDay,
      isDefault: input.isDefault,
    });
    await this.deps.audit.record(context, {
      action: 'provider.updated',
      entityType: 'email_provider',
      entityId: providerId,
      metadata: { credentialsChanged: input.credentials !== null },
    });
    return provider;
  }

  /** Verifica la conexión con el proveedor real y deja el estado en ACTIVE o ERROR. */
  async verify(context: TenantContext, providerId: string) {
    assertCan(context, 'provider:manage');
    const stored = await this.deps.providers.findById(context, providerId);
    if (!stored) throw new DomainError('NOT_FOUND', 'Proveedor inexistente');
    if (!stored.credentialsEnc) {
      throw new DomainError('INVALID_STATE', 'El proveedor no tiene credenciales');
    }
    const connection = parseProviderConnection(
      stored.kind,
      stored.settings,
      JSON.parse(
        this.deps.cipher.decrypt(
          stored.credentialsEnc,
          providerCredentialsAad(context.tenantId, providerId),
        ),
      ),
    );
    const result = await this.deps.factory.create(connection).verify();
    const now = this.deps.clock.now();
    await this.deps.providers.setStatus(
      context,
      providerId,
      result.ok ? 'ACTIVE' : 'ERROR',
      result.ok ? null : result.message.slice(0, 500),
      result.ok ? now : null,
    );
    await this.deps.audit.record(context, {
      action: 'provider.verified',
      entityType: 'email_provider',
      entityId: providerId,
      metadata: { ok: result.ok },
    });
    return result;
  }

  async delete(context: TenantContext, providerId: string) {
    assertCan(context, 'provider:manage');
    const senders = await this.deps.senders.list(context);
    if (senders.some((sender) => sender.providerConfigId === providerId)) {
      throw new DomainError('CONFLICT', 'El proveedor tiene remitentes asociados', {
        reason: 'PROVIDER_IN_USE',
      });
    }
    if (!(await this.deps.providers.delete(context, providerId))) {
      throw new DomainError('NOT_FOUND', 'Proveedor inexistente');
    }
    await this.deps.audit.record(context, {
      action: 'provider.deleted',
      entityType: 'email_provider',
      entityId: providerId,
    });
  }

  private encrypt(context: TenantContext, providerId: string, credentials: object): string {
    return this.deps.cipher.encrypt(
      JSON.stringify(credentials),
      providerCredentialsAad(context.tenantId, providerId),
    );
  }
}

export class ManageSendersUseCase {
  constructor(private readonly deps: ProviderUseCaseDeps) {}

  /** Lectura para elegir remitente en una campaña (no requiere gestionar proveedores). */
  list(context: TenantContext) {
    assertCan(context, 'campaign:read');
    return this.deps.senders.list(context);
  }

  async create(context: TenantContext, input: SenderInput) {
    assertCan(context, 'sender:manage');
    await this.assertProvider(context, input.providerConfigId);
    const sender = await this.deps.senders.create(context, {
      ...input,
      fromEmail: input.fromEmail.toLowerCase(),
    });
    await this.deps.audit.record(context, {
      action: 'sender.created',
      entityType: 'sender',
      entityId: sender.id,
      metadata: { fromEmail: sender.fromEmail },
    });
    return this.checkDns(context, sender.id);
  }

  async update(context: TenantContext, senderId: string, input: SenderInput) {
    assertCan(context, 'sender:manage');
    await this.assertProvider(context, input.providerConfigId);
    const sender = await this.deps.senders.update(context, senderId, {
      ...input,
      fromEmail: input.fromEmail.toLowerCase(),
    });
    await this.deps.audit.record(context, {
      action: 'sender.updated',
      entityType: 'sender',
      entityId: senderId,
    });
    return sender;
  }

  async checkDns(context: TenantContext, senderId: string) {
    assertCan(context, 'sender:manage');
    const sender = await this.deps.senders.findById(context, senderId);
    if (!sender) throw new DomainError('NOT_FOUND', 'Remitente inexistente');
    const check = await this.deps.dns.check(senderDomain(sender.fromEmail));
    const at = this.deps.clock.now();
    await this.deps.senders.saveDnsCheck(context, senderId, check, at);
    return { ...sender, dnsCheck: check, dnsCheckedAt: at };
  }

  async delete(context: TenantContext, senderId: string) {
    assertCan(context, 'sender:manage');
    if (!(await this.deps.senders.delete(context, senderId))) {
      throw new DomainError('NOT_FOUND', 'Remitente inexistente');
    }
    await this.deps.audit.record(context, {
      action: 'sender.deleted',
      entityType: 'sender',
      entityId: senderId,
    });
  }

  private async assertProvider(context: TenantContext, providerId: string) {
    if (!(await this.deps.providers.findById(context, providerId))) {
      throw new DomainError('VALIDATION', 'Proveedor inválido', { field: 'providerConfigId' });
    }
  }
}
