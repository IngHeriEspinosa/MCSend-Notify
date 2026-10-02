import { describe, expect, it } from 'vitest';
import { buildRecipientVariables, isKnownVariable } from './template-variables';

describe('variables de plantilla', () => {
  it('construye las variables del destinatario con solo valores escalares', () => {
    const variables = buildRecipientVariables({
      recipient: {
        email: 'ana@example.com',
        firstName: 'Ana',
        lastName: null,
        company: null,
        attributes: { plan: 'Pro', seats: 10, vip: true, nested: { a: 1 }, list: [1] },
      },
      tenantName: 'MCSupport',
      links: { unsubscribeUrl: 'https://u', preferencesUrl: 'https://p' },
      now: new Date('2026-10-02T12:00:00Z'),
    });
    expect(variables.contact).toEqual({
      first_name: 'Ana',
      last_name: '',
      full_name: 'Ana',
      email: 'ana@example.com',
      company: '',
    });
    expect(variables.fields).toEqual({ plan: 'Pro', seats: 10, vip: true });
    expect(variables.current_year).toBe(2026);
  });

  it('reconoce variables de contacto, de sistema y campos del tenant', () => {
    const fields = new Set(['plan']);
    expect(isKnownVariable('contact.first_name', fields)).toBe(true);
    expect(isKnownVariable('unsubscribe_url', fields)).toBe(true);
    expect(isKnownVariable('fields.plan', fields)).toBe(true);
    expect(isKnownVariable('fields.otro', fields)).toBe(false);
    expect(isKnownVariable('contact.password', fields)).toBe(false);
  });
});
