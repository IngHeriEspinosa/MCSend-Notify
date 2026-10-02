/**
 * Configuración de proveedores de correo por tenant (Strategy): SMTP, Microsoft Graph, Resend y
 * Amazon SES. Cada tipo separa ajustes visibles de credenciales secretas; las credenciales solo
 * viajan del formulario al cifrado y del descifrado al adaptador, nunca de vuelta al cliente.
 */
import { z } from 'zod';

export const EMAIL_PROVIDER_KINDS = ['SMTP', 'MICROSOFT_GRAPH', 'RESEND', 'SES'] as const;
export type EmailProviderKind = (typeof EMAIL_PROVIDER_KINDS)[number];

export const PROVIDER_STATUSES = ['ACTIVE', 'ERROR', 'DISABLED'] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$/, 'INVALID_HOST');
const secret = (max = 512) => z.string().trim().min(1).max(max);

export const smtpSettingsSchema = z.object({
  host: hostname,
  port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls', 'none']),
});
export const smtpCredentialsSchema = z.object({
  username: z.string().trim().max(256).nullable(),
  password: z.string().max(512).nullable(),
});

export const graphSettingsSchema = z.object({
  azureTenantId: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[A-Za-z0-9.-]+$/),
  clientId: z.uuid(),
});
export const graphCredentialsSchema = z.object({ clientSecret: secret() });

export const resendSettingsSchema = z.object({});
export const resendCredentialsSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .regex(/^re_[A-Za-z0-9_]{8,200}$/, 'INVALID_API_KEY'),
  webhookSecret: z
    .string()
    .trim()
    .regex(/^whsec_[A-Za-z0-9+/=]{16,200}$/, 'INVALID_WEBHOOK_SECRET')
    .nullable(),
});

export const sesSettingsSchema = z.object({
  region: z
    .string()
    .trim()
    .regex(/^[a-z]{2}(-[a-z]+)+-\d$/, 'INVALID_REGION'),
  configurationSet: z.string().trim().max(64).nullable(),
});
export const sesCredentialsSchema = z.object({
  accessKeyId: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{16,128}$/, 'INVALID_ACCESS_KEY'),
  secretAccessKey: secret(256),
});

export type SmtpSettings = z.infer<typeof smtpSettingsSchema>;
export type SmtpCredentials = z.infer<typeof smtpCredentialsSchema>;
export type GraphSettings = z.infer<typeof graphSettingsSchema>;
export type GraphCredentials = z.infer<typeof graphCredentialsSchema>;
export type ResendCredentials = z.infer<typeof resendCredentialsSchema>;
export type SesSettings = z.infer<typeof sesSettingsSchema>;
export type SesCredentials = z.infer<typeof sesCredentialsSchema>;

/** Configuración ya descifrada que recibe el adaptador (unión discriminada por tipo). */
export type ProviderConnection =
  | { kind: 'SMTP'; settings: SmtpSettings; credentials: SmtpCredentials }
  | { kind: 'MICROSOFT_GRAPH'; settings: GraphSettings; credentials: GraphCredentials }
  | { kind: 'RESEND'; settings: Record<string, never>; credentials: ResendCredentials }
  | { kind: 'SES'; settings: SesSettings; credentials: SesCredentials };

/** Límites por defecto según las cuotas habituales de cada proveedor. */
export const PROVIDER_DEFAULTS: Record<
  EmailProviderKind,
  { rateLimitPerSecond: number; maxPerDay: number | null; supportsWebhooks: boolean }
> = {
  SMTP: { rateLimitPerSecond: 10, maxPerDay: null, supportsWebhooks: false },
  // Exchange Online: ~30 mensajes/min y 10.000 destinatarios/día por buzón.
  MICROSOFT_GRAPH: { rateLimitPerSecond: 0.5, maxPerDay: 10_000, supportsWebhooks: false },
  RESEND: { rateLimitPerSecond: 2, maxPerDay: null, supportsWebhooks: true },
  SES: { rateLimitPerSecond: 14, maxPerDay: null, supportsWebhooks: true },
};

const limits = {
  name: z.string().trim().min(2).max(80),
  /** Admite decimales: 0,5 = un envío cada 2 s (30 por minuto). */
  rateLimitPerSecond: z.number().min(0.1).max(500),
  maxPerDay: z.number().int().min(1).max(10_000_000).nullable(),
  isDefault: z.boolean(),
};

/**
 * Alta o edición. En edición, `credentials: null` conserva las credenciales guardadas
 * (el formulario nunca las recibe para poder reenviarlas).
 */
export const providerInputSchema = z.discriminatedUnion('kind', [
  z.object({
    ...limits,
    kind: z.literal('SMTP'),
    settings: smtpSettingsSchema,
    credentials: smtpCredentialsSchema.nullable(),
  }),
  z.object({
    ...limits,
    kind: z.literal('MICROSOFT_GRAPH'),
    settings: graphSettingsSchema,
    credentials: graphCredentialsSchema.nullable(),
  }),
  z.object({
    ...limits,
    kind: z.literal('RESEND'),
    settings: resendSettingsSchema,
    credentials: resendCredentialsSchema.nullable(),
  }),
  z.object({
    ...limits,
    kind: z.literal('SES'),
    settings: sesSettingsSchema,
    credentials: sesCredentialsSchema.nullable(),
  }),
]);

export type ProviderInput = z.infer<typeof providerInputSchema>;

/** Valida el JSON guardado de credenciales y ajustes y construye la conexión del adaptador. */
export function parseProviderConnection(
  kind: EmailProviderKind,
  settings: unknown,
  credentials: unknown,
): ProviderConnection {
  switch (kind) {
    case 'SMTP':
      return {
        kind,
        settings: smtpSettingsSchema.parse(settings),
        credentials: smtpCredentialsSchema.parse(credentials),
      };
    case 'MICROSOFT_GRAPH':
      return {
        kind,
        settings: graphSettingsSchema.parse(settings),
        credentials: graphCredentialsSchema.parse(credentials),
      };
    case 'RESEND':
      return { kind, settings: {}, credentials: resendCredentialsSchema.parse(credentials) };
    case 'SES':
      return {
        kind,
        settings: sesSettingsSchema.parse(settings),
        credentials: sesCredentialsSchema.parse(credentials),
      };
  }
}

export interface ProviderView {
  id: string;
  name: string;
  kind: EmailProviderKind;
  settings: Record<string, unknown>;
  hasCredentials: boolean;
  endpointToken: string;
  rateLimitPerSecond: number;
  maxPerDay: number | null;
  status: ProviderStatus;
  lastError: string | null;
  lastVerifiedAt: Date | null;
  configVersion: number;
  isDefault: boolean;
  senderCount: number;
}

export const senderInputSchema = z.object({
  providerConfigId: z.uuid(),
  fromName: z.string().trim().min(1).max(100),
  fromEmail: z.email().max(254),
  replyTo: z.email().max(254).nullable(),
  isDefault: z.boolean(),
});

export type SenderInput = z.infer<typeof senderInputSchema>;

export type DnsRecordStatus = 'pass' | 'missing' | 'fail';

export interface DnsCheckResult {
  domain: string;
  spf: DnsRecordStatus;
  dkim: DnsRecordStatus;
  dmarc: DnsRecordStatus;
  /** Selector DKIM encontrado (p. ej. `resend`, `selector1`). */
  dkimSelector: string | null;
}

export interface SenderView {
  id: string;
  providerConfigId: string;
  providerName: string;
  providerKind: EmailProviderKind;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  isDefault: boolean;
  dnsCheck: DnsCheckResult | null;
  dnsCheckedAt: Date | null;
}

export function senderDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

export function isDnsHealthy(check: DnsCheckResult | null): boolean {
  return check !== null && check.spf === 'pass' && check.dkim === 'pass' && check.dmarc === 'pass';
}
