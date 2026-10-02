import { describe, expect, it } from 'vitest';
import { DomainError, isDomainError } from './domain-error';

describe('isDomainError', () => {
  it('reconoce instancias propias y rechaza otros errores', () => {
    expect(isDomainError(new DomainError('NOT_FOUND', 'x'))).toBe(true);
    expect(isDomainError(new Error('x'))).toBe(false);
    expect(isDomainError(null)).toBe(false);
    expect(isDomainError({ code: 'NOT_FOUND' })).toBe(false);
  });

  it('reconoce errores de otra copia del módulo (capas de Next.js) por su marca global', () => {
    const foreign = Object.assign(new Error('copia'), {
      [Symbol.for('mc-send-notify.DomainError')]: true,
      code: 'VALIDATION',
    });
    expect(isDomainError(foreign)).toBe(true);
  });
});
