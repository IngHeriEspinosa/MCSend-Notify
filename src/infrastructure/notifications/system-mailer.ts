/**
 * Correo del sistema por SMTP (`SYSTEM_MAIL_SMTP_URL`): invitaciones y recuperación de contraseña.
 * Plantillas sencillas en español e inglés con todo dato variable escapado.
 */
import { createTransport, type Transporter } from 'nodemailer';
import type { SystemMailer, SystemMailMessage } from '@/core/identity/system-mail';
import { escapeHtml } from '../rendering/html';

interface RenderedSystemMail {
  subject: string;
  html: string;
  text: string;
}

const COPY = {
  es: {
    inviteSubject: (tenant: string) => `Te han invitado a ${tenant} en MC Send Notify`,
    inviteBody: (tenant: string, inviter: string | null) =>
      `${inviter ? `${inviter} te ha invitado` : 'Te han invitado'} a colaborar en ${tenant}.`,
    inviteCta: 'Aceptar la invitación',
    resetSubject: 'Recupera tu contraseña de MC Send Notify',
    resetBody:
      'Recibimos una solicitud para cambiar tu contraseña. Si no fuiste tú, ignora este correo.',
    resetCta: 'Elegir una contraseña nueva',
    expires: (date: string) => `El enlace caduca el ${date}.`,
    footer: 'Multicómputos · MC Send Notify',
  },
  en: {
    inviteSubject: (tenant: string) => `You have been invited to ${tenant} on MC Send Notify`,
    inviteBody: (tenant: string, inviter: string | null) =>
      `${inviter ? `${inviter} invited you` : 'You have been invited'} to collaborate on ${tenant}.`,
    inviteCta: 'Accept invitation',
    resetSubject: 'Reset your MC Send Notify password',
    resetBody:
      'We received a request to change your password. If it was not you, ignore this email.',
    resetCta: 'Choose a new password',
    expires: (date: string) => `The link expires on ${date}.`,
    footer: 'Multicómputos · MC Send Notify',
  },
} as const;

export function renderSystemMail(message: SystemMailMessage): RenderedSystemMail {
  const copy = COPY[message.locale];
  const expires = copy.expires(
    new Intl.DateTimeFormat(message.locale, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(message.expiresAt) + ' UTC',
  );
  const [subject, body, cta] =
    message.kind === 'invitation'
      ? [
          copy.inviteSubject(message.tenantName),
          copy.inviteBody(message.tenantName, message.inviterName),
          copy.inviteCta,
        ]
      : [copy.resetSubject, copy.resetBody, copy.resetCta];
  const html = `<!doctype html><html lang="${message.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background-color:#F4F6F8;font-family:Arial,Helvetica,sans-serif;color:#1F2328;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFFFFF;border-top:4px solid #005E7D;">
<tr><td style="padding:32px;">
<p style="margin:0 0 16px 0;font-size:20px;font-weight:bold;color:#005E7D;">MC Send Notify</p>
<p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;">${escapeHtml(body)}</p>
<p style="margin:0 0 24px 0;"><a href="${escapeHtml(message.url)}" style="display:inline-block;padding:12px 24px;background-color:#005E7D;color:#FFFFFF;text-decoration:none;font-weight:bold;border-radius:6px;">${escapeHtml(cta)}</a></p>
<p style="margin:0 0 8px 0;font-size:13px;color:#5F6368;">${escapeHtml(expires)}</p>
<p style="margin:0;font-size:13px;color:#5F6368;word-break:break-all;">${escapeHtml(message.url)}</p>
</td></tr></table>
<p style="margin:16px 0 0 0;font-size:12px;color:#5F6368;">${escapeHtml(copy.footer)}</p>
</td></tr></table></body></html>`;
  return {
    subject,
    html,
    text: `${body}\n\n${cta}: ${message.url}\n\n${expires}\n\n${copy.footer}`,
  };
}

export class SmtpSystemMailer implements SystemMailer {
  private transporter: Transporter | null = null;

  constructor(
    private readonly url: string | undefined,
    private readonly from: string,
  ) {}

  async send(message: SystemMailMessage): Promise<void> {
    if (!this.url) throw new Error('SYSTEM_MAIL_SMTP_URL no está configurada');
    this.transporter ??= createTransport(this.url);
    const rendered = renderSystemMail(message);
    await this.transporter.sendMail({ from: this.from, to: message.to, ...rendered });
  }
}
