/**
 * Construcción del mensaje MIME (multipart/alternative con HTML y texto) con nodemailer.
 * Lo usan los proveedores que envían el mensaje en bruto (SES Raw y Microsoft Graph) para
 * conservar el Message-ID determinista y las cabeceras List-Unsubscribe.
 */
import MailComposer from 'nodemailer/lib/mail-composer';
import type { OutboundEmail } from '@/core/providers/ports';

export function mailOptions(email: OutboundEmail) {
  return {
    from: { name: email.from.name, address: email.from.email },
    to: email.to,
    ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    subject: email.subject,
    html: email.html,
    text: email.text,
    messageId: email.messageId,
    headers: email.headers,
  };
}

export function buildMime(email: OutboundEmail): Promise<Buffer> {
  return new MailComposer(mailOptions(email)).compile().build();
}

/** `"Nombre" <correo>` con el nombre sin comillas ni saltos de línea. */
export function formatAddress(name: string, email: string): string {
  const safe = name.replace(/["\r\n<>]/g, '').trim();
  return safe ? `"${safe}" <${email}>` : email;
}

/** Segundos de la cabecera Retry-After (o una fecha HTTP) en milisegundos. */
export function retryAfterMs(header: string | null, fallbackMs: number): number {
  if (!header) return fallbackMs;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? fallbackMs : Math.max(1000, date - Date.now());
}
