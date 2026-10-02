/** Puertos del módulo de proveedores de correo. */
import type { TenantContext } from '@/core/shared/tenant-context';
import type {
  DnsCheckResult,
  EmailProviderKind,
  ProviderConnection,
  ProviderStatus,
  ProviderView,
  SenderView,
} from './provider-config';

/** Mensaje listo para enviar (ya personalizado). */
export interface OutboundEmail {
  from: { name: string; email: string };
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  /** Message-ID determinista `<{deliveryId}@{dominio}>`: un reintento no crea otro mensaje lógico. */
  messageId: string;
  /** Cabeceras adicionales (List-Unsubscribe, List-Unsubscribe-Post, X-MCSN-Delivery). */
  headers: Record<string, string>;
  /** Clave de idempotencia para APIs que la admiten (Resend). */
  idempotencyKey: string;
}

export const SEND_ERROR_CODES = [
  'AUTH',
  'CONFIG',
  'RATE_LIMITED',
  'TRANSIENT',
  'REJECTED',
  'INVALID_RECIPIENT',
] as const;
export type SendErrorCode = (typeof SEND_ERROR_CODES)[number];

export type SendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      code: SendErrorCode;
      retryable: boolean;
      message: string;
      retryAfterMs?: number | undefined;
    };

export type VerifyResult = { ok: true } | { ok: false; message: string };

export interface EmailProvider {
  send(email: OutboundEmail): Promise<SendResult>;
  verify(): Promise<VerifyResult>;
}

export interface EmailProviderFactory {
  create(connection: ProviderConnection): EmailProvider;
}

export interface StoredProvider extends ProviderView {
  tenantId: string;
  credentialsEnc: string | null;
}

export interface ProviderWrite {
  name: string;
  kind: EmailProviderKind;
  settings: Record<string, unknown>;
  credentialsEnc: string | null;
  rateLimitPerSecond: number;
  maxPerDay: number | null;
  isDefault: boolean;
}

export interface ProviderConfigRepository {
  list(context: TenantContext): Promise<ProviderView[]>;
  findById(context: TenantContext, providerId: string): Promise<StoredProvider | null>;
  /** Búsqueda global por el token de la URL de webhooks (identifica al tenant). */
  findByEndpointToken(endpointToken: string): Promise<StoredProvider | null>;
  /** El id se genera antes para usarlo como AAD del cifrado. */
  create(
    context: TenantContext,
    id: string,
    endpointToken: string,
    input: ProviderWrite,
  ): Promise<ProviderView>;
  update(context: TenantContext, providerId: string, input: ProviderWrite): Promise<ProviderView>;
  setStatus(
    context: TenantContext,
    providerId: string,
    status: ProviderStatus,
    lastError: string | null,
    verifiedAt: Date | null,
  ): Promise<void>;
  delete(context: TenantContext, providerId: string): Promise<boolean>;
}

export interface SenderRepository {
  list(context: TenantContext): Promise<SenderView[]>;
  findById(context: TenantContext, senderId: string): Promise<SenderView | null>;
  create(
    context: TenantContext,
    input: {
      providerConfigId: string;
      fromName: string;
      fromEmail: string;
      replyTo: string | null;
      isDefault: boolean;
    },
  ): Promise<SenderView>;
  update(
    context: TenantContext,
    senderId: string,
    input: {
      providerConfigId: string;
      fromName: string;
      fromEmail: string;
      replyTo: string | null;
      isDefault: boolean;
    },
  ): Promise<SenderView>;
  saveDnsCheck(
    context: TenantContext,
    senderId: string,
    check: DnsCheckResult,
    at: Date,
  ): Promise<void>;
  delete(context: TenantContext, senderId: string): Promise<boolean>;
}

/** Comprobación de SPF, DKIM y DMARC del dominio del remitente. */
export interface DnsChecker {
  check(domain: string): Promise<DnsCheckResult>;
}

/**
 * Acceso a un proveedor listo para enviar: carga la configuración, descifra las credenciales y
 * reutiliza la conexión mientras no cambie `configVersion` (pool SMTP, token de Graph).
 */
export interface EmailProviderGateway {
  forProvider(
    context: TenantContext,
    providerId: string,
  ): Promise<{
    provider: EmailProvider;
    status: ProviderStatus;
    rateLimitPerSecond: number;
    maxPerDay: number | null;
  } | null>;
}
