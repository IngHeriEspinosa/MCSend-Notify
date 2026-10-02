import { describe, expect, it } from 'vitest';
import { formatAddress, retryAfterMs } from './mime';
import { classifySesError } from './ses.provider';
import { classifySmtpError } from './smtp.provider';

function named(name: string): Error {
  const error = new Error('detalle');
  error.name = name;
  return error;
}

describe('clasificación de errores de proveedores', () => {
  it.each([
    [{ code: 'EAUTH', responseCode: 535 }, 'AUTH', false],
    [{ responseCode: 421 }, 'RATE_LIMITED', true],
    [{ responseCode: 450 }, 'TRANSIENT', true],
    [{ responseCode: 550 }, 'INVALID_RECIPIENT', false],
    [{ responseCode: 554 }, 'REJECTED', false],
    [{ code: 'ETIMEDOUT' }, 'TRANSIENT', true],
    [{ code: 'ENOTFOUND' }, 'CONFIG', false],
  ])('SMTP %j → %s', (error, code, retryable) => {
    expect(classifySmtpError(error)).toMatchObject({ code, retryable });
  });

  it.each([
    ['InvalidClientTokenId', 'AUTH'],
    ['MailFromDomainNotVerifiedException', 'CONFIG'],
    ['TooManyRequestsException', 'RATE_LIMITED'],
    ['MessageRejected', 'REJECTED'],
    ['InternalFailure', 'TRANSIENT'],
  ])('SES %s → %s', (name, code) => {
    expect(classifySesError(named(name)).code).toBe(code);
  });

  it('formatea el remitente sin permitir inyectar cabeceras', () => {
    expect(formatAddress('MC "Support"\r\nBcc: x@y.z', 'a@b.c')).toBe(
      '"MC SupportBcc: x@y.z" <a@b.c>',
    );
    expect(formatAddress('', 'a@b.c')).toBe('a@b.c');
  });

  it('interpreta Retry-After en segundos o fecha HTTP', () => {
    expect(retryAfterMs('30', 1000)).toBe(30_000);
    expect(retryAfterMs(null, 1234)).toBe(1234);
    expect(retryAfterMs('no-válido', 999)).toBe(999);
  });
});
