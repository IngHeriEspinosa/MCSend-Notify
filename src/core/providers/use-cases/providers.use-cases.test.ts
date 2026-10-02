import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, FakeTokenService, RecordingAuditLogger } from '@tests/fakes/identity.fakes';
import {
  InMemoryProviderRepository,
  InMemorySenderRepository,
  ownerContext,
} from '@tests/fakes/sending.fakes';
import type { SecretCipher } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { ProviderInput } from '../provider-config';
import type { EmailProviderFactory } from '../ports';
import {
  ManageProvidersUseCase,
  ManageSendersUseCase,
  type ProviderUseCaseDeps,
} from './providers.use-cases';

/** Cifrado reversible de pruebas que exige el AAD correcto. */
const cipher: SecretCipher = {
  encrypt: (plaintext, aad) => `enc(${aad})${plaintext}`,
  decrypt: (payload, aad) => {
    const prefix = `enc(${aad})`;
    if (!payload.startsWith(prefix)) throw new Error('AAD incorrecto');
    return payload.slice(prefix.length);
  },
};

let deps: ProviderUseCaseDeps & {
  providers: InMemoryProviderRepository;
  senders: InMemorySenderRepository;
};
let verifyResult: { ok: true } | { ok: false; message: string };
let connections: unknown[];

const smtp = (credentials: ProviderInput['credentials']): ProviderInput => ({
  name: 'Servidor propio',
  kind: 'SMTP',
  settings: { host: 'smtp.multicomputos.com', port: 587, security: 'starttls' },
  credentials: credentials as { username: string | null; password: string | null } | null,
  rateLimitPerSecond: 5,
  maxPerDay: null,
  isDefault: false,
});

beforeEach(() => {
  verifyResult = { ok: true };
  connections = [];
  const factory: EmailProviderFactory = {
    create: (connection) => {
      connections.push(connection);
      return {
        send: async () => ({ ok: true, providerMessageId: 'x' }),
        verify: async () => verifyResult,
      };
    },
  };
  let id = 0;
  deps = {
    providers: new InMemoryProviderRepository(),
    senders: new InMemorySenderRepository(),
    cipher,
    factory,
    dns: {
      check: async (domain) => ({
        domain,
        spf: 'pass',
        dkim: 'missing',
        dmarc: 'pass',
        dkimSelector: null,
      }),
    },
    tokens: new FakeTokenService(),
    audit: new RecordingAuditLogger(),
    clock: new FakeClock(),
    ids: { uuid: () => `55555555-5555-7555-8555-00000000000${(id += 1)}` },
  };
});

function editor(): TenantContext {
  return {
    ...ownerContext,
    actor: { type: 'user', userId: 'u', role: 'EDITOR', isPlatformAdmin: false },
  };
}

describe('ManageProvidersUseCase', () => {
  it('cifra las credenciales ligadas a la fila y nunca las devuelve', async () => {
    const created = await new ManageProvidersUseCase(deps).create(
      ownerContext,
      smtp({ username: 'app', password: 's3creto' }),
    );
    const stored = deps.providers.providers.get(created.id);
    expect(stored?.credentialsEnc).toBe(
      `enc(${ownerContext.tenantId}:email_provider:${created.id}){"username":"app","password":"s3creto"}`,
    );
    const view = await new ManageProvidersUseCase(deps).get(ownerContext, created.id);
    expect(view).not.toHaveProperty('credentialsEnc');
  });

  it('al editar sin credenciales conserva las guardadas', async () => {
    const created = await new ManageProvidersUseCase(deps).create(
      ownerContext,
      smtp({ username: 'app', password: 's3creto' }),
    );
    const before = deps.providers.providers.get(created.id)?.credentialsEnc;
    await new ManageProvidersUseCase(deps).update(ownerContext, created.id, smtp(null));
    expect(deps.providers.providers.get(created.id)?.credentialsEnc).toBe(before);
  });

  it('probar conexión descifra, verifica con el proveedor y guarda el estado', async () => {
    const created = await new ManageProvidersUseCase(deps).create(
      ownerContext,
      smtp({ username: 'app', password: 's3creto' }),
    );
    verifyResult = { ok: false, message: '535 Authentication failed' };
    await new ManageProvidersUseCase(deps).verify(ownerContext, created.id);
    expect(connections[0]).toMatchObject({ kind: 'SMTP', credentials: { password: 's3creto' } });
    expect(deps.providers.providers.get(created.id)).toMatchObject({
      status: 'ERROR',
      lastError: '535 Authentication failed',
    });
    verifyResult = { ok: true };
    await new ManageProvidersUseCase(deps).verify(ownerContext, created.id);
    expect(deps.providers.providers.get(created.id)?.status).toBe('ACTIVE');
  });

  it('no permite eliminar un proveedor con remitentes ni gestionarlo a un EDITOR', async () => {
    const [provider] = await deps.providers.list();
    await expect(
      new ManageProvidersUseCase(deps).delete(ownerContext, provider!.id),
    ).rejects.toMatchObject({
      details: { reason: 'PROVIDER_IN_USE' },
    });
    expect(() => new ManageProvidersUseCase(deps).list(editor())).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    );
  });
});

describe('ManageSendersUseCase', () => {
  it('al crear un remitente normaliza el email y comprueba su DNS', async () => {
    const [provider] = await deps.providers.list();
    const sender = await new ManageSendersUseCase(deps).create(ownerContext, {
      providerConfigId: provider!.id,
      fromName: 'MCLog',
      fromEmail: 'Avisos@MCLog.Example',
      replyTo: null,
      isDefault: false,
    });
    expect(sender.fromEmail).toBe('avisos@mclog.example');
    expect(sender.dnsCheck).toMatchObject({ domain: 'mclog.example', dkim: 'missing' });
  });

  it('rechaza un proveedor de otro tenant o inexistente', async () => {
    await expect(
      new ManageSendersUseCase(deps).create(ownerContext, {
        providerConfigId: '99999999-9999-7999-8999-999999999999',
        fromName: 'X',
        fromEmail: 'x@y.z',
        replyTo: null,
        isDefault: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
