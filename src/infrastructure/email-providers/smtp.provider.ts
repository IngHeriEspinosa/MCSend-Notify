/**
 * Proveedor SMTP (nodemailer con pool de conexiones).
 *
 * Contra SSRF y DNS rebinding, el host se resuelve una vez, se exige que sea público y se conecta
 * a esa IP; el nombre original se usa como SNI para validar el certificado TLS.
 */
import { lookup } from 'node:dns/promises';
import { createTransport, type Transporter } from 'nodemailer';
import type { SmtpCredentials, SmtpSettings } from '@/core/providers/provider-config';
import type {
  EmailProvider,
  OutboundEmail,
  SendResult,
  VerifyResult,
} from '@/core/providers/ports';
import { assertPublicHost } from '../security/network-guard';
import { mailOptions } from './mime';

interface SmtpError {
  code?: string;
  responseCode?: number;
  message?: string;
}

function asSmtpError(error: unknown): SmtpError {
  return typeof error === 'object' && error !== null
    ? (error as SmtpError)
    : { message: String(error) };
}

export function classifySmtpError(error: unknown): Exclude<SendResult, { ok: true }> {
  const { code, responseCode, message = 'Error SMTP' } = asSmtpError(error);
  const text = message.slice(0, 300);
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534) {
    return { ok: false, code: 'AUTH', retryable: false, message: text };
  }
  if (code === 'EBLOCKEDHOST' || code === 'ENOTFOUND' || code === 'ETLS') {
    return { ok: false, code: 'CONFIG', retryable: false, message: text };
  }
  if (responseCode === 421 || responseCode === 451 || responseCode === 452) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      retryable: true,
      message: text,
      retryAfterMs: 30_000,
    };
  }
  if (responseCode !== undefined && responseCode >= 400 && responseCode < 500) {
    return { ok: false, code: 'TRANSIENT', retryable: true, message: text };
  }
  if (responseCode === 550 || responseCode === 551 || responseCode === 553) {
    return { ok: false, code: 'INVALID_RECIPIENT', retryable: false, message: text };
  }
  if (responseCode !== undefined && responseCode >= 500) {
    return { ok: false, code: 'REJECTED', retryable: false, message: text };
  }
  return { ok: false, code: 'TRANSIENT', retryable: true, message: text };
}

export class SmtpEmailProvider implements EmailProvider {
  private transporter: Promise<Transporter> | null = null;

  constructor(
    private readonly settings: SmtpSettings,
    private readonly credentials: SmtpCredentials,
    private readonly allowPrivate: boolean,
  ) {}

  private async createTransporter(): Promise<Transporter> {
    let host = this.settings.host;
    if (!this.allowPrivate) {
      await assertPublicHost(host, false);
      host = (await lookup(this.settings.host)).address;
    }
    const auth = this.credentials.username
      ? { user: this.credentials.username, pass: this.credentials.password ?? '' }
      : undefined;
    return createTransport({
      host,
      port: this.settings.port,
      secure: this.settings.security === 'tls',
      requireTLS: this.settings.security === 'starttls',
      ignoreTLS: this.settings.security === 'none',
      ...(auth ? { auth } : {}),
      pool: true,
      maxConnections: 3,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      tls: { servername: this.settings.host, rejectUnauthorized: true },
    });
  }

  private transport(): Promise<Transporter> {
    this.transporter ??= this.createTransporter().catch((error: unknown) => {
      this.transporter = null;
      throw error;
    });
    return this.transporter;
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    try {
      const transporter = await this.transport();
      const info: { messageId?: string } = await transporter.sendMail(mailOptions(email));
      return { ok: true, providerMessageId: info.messageId ?? email.messageId };
    } catch (error) {
      if (error instanceof Error && error.name === 'BlockedHostError') {
        return { ok: false, code: 'CONFIG', retryable: false, message: error.message };
      }
      return classifySmtpError(error);
    }
  }

  async verify(): Promise<VerifyResult> {
    try {
      await (await this.transport()).verify();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message.slice(0, 300) : 'Error SMTP',
      };
    }
  }

  async close(): Promise<void> {
    const transporter = await this.transporter?.catch(() => null);
    transporter?.close();
    this.transporter = null;
  }
}
