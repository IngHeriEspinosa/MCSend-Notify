import { describe, expect, it } from 'vitest';
import { renderSystemMail } from './system-mailer';

describe('renderSystemMail', () => {
  it('genera la invitación en español con el enlace y los datos escapados', () => {
    const mail = renderSystemMail({
      kind: 'invitation',
      to: 'ana@cliente.com',
      locale: 'es',
      tenantName: 'MCSupport <script>',
      inviterName: 'Luis "Admin"',
      url: 'https://app.test/es/invite/token?x=1&y=2',
      expiresAt: new Date('2026-10-09T12:00:00Z'),
    });
    expect(mail.subject).toContain('MCSupport <script>');
    expect(mail.html).toContain('MCSupport &lt;script&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('href="https://app.test/es/invite/token?x=1&amp;y=2"');
    expect(mail.text).toContain('Aceptar la invitación: https://app.test/es/invite/token?x=1&y=2');
  });

  it('genera la recuperación de contraseña en inglés', () => {
    const mail = renderSystemMail({
      kind: 'password-reset',
      to: 'ana@cliente.com',
      locale: 'en',
      url: 'https://app.test/en/reset-password/abc',
      expiresAt: new Date('2026-10-02T13:00:00Z'),
    });
    expect(mail.subject).toBe('Reset your MC Send Notify password');
    expect(mail.text).toContain('Choose a new password: https://app.test/en/reset-password/abc');
  });

  it('genera la solicitud de aprobación con el asunto y los destinatarios escapados', () => {
    const mail = renderSystemMail({
      kind: 'approval-request',
      to: 'aprobador@multicomputos.com',
      locale: 'es',
      tenantName: 'MCSupport',
      automationName: 'Resumen semanal',
      subject: 'Novedades <b>3.2</b>',
      recipients: 1250,
      url: 'https://app.test/es/t/mcsupport/approvals/abc',
      expiresAt: new Date('2026-10-04T12:00:00Z'),
    });
    expect(mail.subject).toBe('Aprobación pendiente: Resumen semanal');
    expect(mail.html).toContain('Novedades &lt;b&gt;3.2&lt;/b&gt;');
    expect(mail.html).toContain('1250 destinatarios');
    expect(mail.text).toContain(
      'Revisar la campaña: https://app.test/es/t/mcsupport/approvals/abc',
    );
  });
});
