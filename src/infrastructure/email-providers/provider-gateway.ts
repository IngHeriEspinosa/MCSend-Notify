/**
 * Fábrica de adaptadores (Strategy por tipo de proveedor) y acceso con caché: la conexión de cada
 * proveedor se reutiliza mientras no cambie su `configVersion` (pool SMTP, token de Graph).
 */
import { parseProviderConnection, type ProviderConnection } from '@/core/providers/provider-config';
import type {
  EmailProvider,
  EmailProviderFactory,
  EmailProviderGateway,
  ProviderConfigRepository,
} from '@/core/providers/ports';
import { providerCredentialsAad } from '@/core/providers/use-cases/providers.use-cases';
import type { SecretCipher } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { GraphEmailProvider, ResendEmailProvider } from './http-providers';
import { SesEmailProvider } from './ses.provider';
import { SmtpEmailProvider } from './smtp.provider';

interface Closable {
  close?: () => void | Promise<void>;
}

export class DefaultEmailProviderFactory implements EmailProviderFactory {
  constructor(private readonly options: { allowPrivateHosts: boolean }) {}

  create(connection: ProviderConnection): EmailProvider {
    switch (connection.kind) {
      case 'SMTP':
        return new SmtpEmailProvider(
          connection.settings,
          connection.credentials,
          this.options.allowPrivateHosts,
        );
      case 'MICROSOFT_GRAPH':
        return new GraphEmailProvider(connection.settings, connection.credentials);
      case 'RESEND':
        return new ResendEmailProvider(connection.credentials);
      case 'SES':
        return new SesEmailProvider(connection.settings, connection.credentials);
    }
  }
}

export class CachingEmailProviderGateway implements EmailProviderGateway {
  private readonly cache = new Map<string, { version: number; provider: EmailProvider }>();

  constructor(
    private readonly providers: ProviderConfigRepository,
    private readonly cipher: SecretCipher,
    private readonly factory: EmailProviderFactory,
  ) {}

  async forProvider(context: TenantContext, providerId: string) {
    const stored = await this.providers.findById(context, providerId);
    if (!stored?.credentialsEnc) return null;
    let entry = this.cache.get(providerId);
    if (entry?.version !== stored.configVersion) {
      await (entry?.provider as Closable | undefined)?.close?.();
      const connection = parseProviderConnection(
        stored.kind,
        stored.settings,
        JSON.parse(
          this.cipher.decrypt(
            stored.credentialsEnc,
            providerCredentialsAad(stored.tenantId, providerId),
          ),
        ),
      );
      entry = { version: stored.configVersion, provider: this.factory.create(connection) };
      this.cache.set(providerId, entry);
    }
    return {
      provider: entry.provider,
      status: stored.status,
      rateLimitPerSecond: stored.rateLimitPerSecond,
      maxPerDay: stored.maxPerDay,
    };
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(
      [...this.cache.values()].map((entry) => (entry.provider as Closable).close?.()),
    );
    this.cache.clear();
  }
}
