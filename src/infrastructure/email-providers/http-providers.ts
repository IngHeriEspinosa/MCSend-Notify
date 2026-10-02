/**
 * Proveedores por API HTTP: Microsoft Graph (Microsoft 365) y Resend.
 * Los endpoints son fijos (no configurables): no hay superficie SSRF.
 */
import type {
  GraphCredentials,
  GraphSettings,
  ResendCredentials,
} from '@/core/providers/provider-config';
import type {
  EmailProvider,
  OutboundEmail,
  SendResult,
  VerifyResult,
} from '@/core/providers/ports';
import { buildMime, formatAddress, retryAfterMs } from './mime';

const TIMEOUT_MS = 30_000;

function httpFailure(
  status: number,
  body: string,
  retryAfter: string | null,
): Exclude<SendResult, { ok: true }> {
  const message = `HTTP ${status}: ${body.slice(0, 300)}`;
  if (status === 401 || status === 403)
    return { ok: false, code: 'AUTH', retryable: false, message };
  if (status === 429) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      retryable: true,
      message,
      retryAfterMs: retryAfterMs(retryAfter, 30_000),
    };
  }
  if (status >= 500) return { ok: false, code: 'TRANSIENT', retryable: true, message };
  if (status === 404) return { ok: false, code: 'CONFIG', retryable: false, message };
  return { ok: false, code: 'REJECTED', retryable: false, message };
}

function networkFailure(error: unknown): Exclude<SendResult, { ok: true }> {
  return {
    ok: false,
    code: 'TRANSIENT',
    retryable: true,
    message: error instanceof Error ? error.message.slice(0, 300) : 'Error de red',
  };
}

/**
 * Microsoft Graph `POST /users/{remitente}/sendMail` con el mensaje MIME en base64, que conserva el
 * Message-ID y las cabeceras de baja. Autenticación client credentials (permiso Mail.Send de
 * aplicación, restringido a los buzones remitentes con RBAC for Applications).
 */
export class GraphEmailProvider implements EmailProvider {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly settings: GraphSettings,
    private readonly credentials: GraphCredentials,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const response = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.settings.azureTenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.settings.clientId,
          client_secret: this.credentials.clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!response.ok || !payload.access_token) {
      throw new GraphAuthError(payload.error_description ?? `HTTP ${response.status}`);
    }
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    try {
      const token = await this.accessToken();
      const mime = await buildMime(email);
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email.from.email)}/sendMail`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
          body: mime.toString('base64'),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (response.status === 202) return { ok: true, providerMessageId: email.messageId };
      return httpFailure(
        response.status,
        await response.text(),
        response.headers.get('retry-after'),
      );
    } catch (error) {
      if (error instanceof GraphAuthError) {
        return { ok: false, code: 'AUTH', retryable: false, message: error.message };
      }
      return networkFailure(error);
    }
  }

  async verify(): Promise<VerifyResult> {
    try {
      await this.accessToken();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message.slice(0, 300) : 'Error' };
    }
  }
}

class GraphAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphAuthError';
  }
}

/** Resend `POST /emails` con clave de idempotencia (un reintento no duplica el envío). */
export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly credentials: ResendCredentials) {}

  async send(email: OutboundEmail): Promise<SendResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credentials.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': email.idempotencyKey,
        },
        body: JSON.stringify({
          from: formatAddress(email.from.name, email.from.email),
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
          headers: { ...email.headers, 'Message-ID': email.messageId },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) {
        const payload = (await response.json()) as { id?: string };
        return { ok: true, providerMessageId: payload.id ?? email.messageId };
      }
      return httpFailure(
        response.status,
        await response.text(),
        response.headers.get('retry-after'),
      );
    } catch (error) {
      return networkFailure(error);
    }
  }

  async verify(): Promise<VerifyResult> {
    try {
      const response = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${this.credentials.apiKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return { ok: true };
      const body = await response.text();
      // Una clave restringida a envío no puede listar dominios, pero es válida.
      if (response.status === 401 && body.includes('restricted_api_key')) return { ok: true };
      return { ok: false, message: `HTTP ${response.status}: ${body.slice(0, 200)}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message.slice(0, 300) : 'Error' };
    }
  }
}
