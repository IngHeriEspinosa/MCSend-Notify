import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmSecretCipher } from './aes-gcm-secret-cipher';

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const AAD = 'tenant-a:email_provider:provider-1';

describe('AesGcmSecretCipher', () => {
  it('cifra con IV aleatorio y descifra con el mismo AAD', () => {
    const cipher = new AesGcmSecretCipher(new Map([['k1', k1]]), 'k1');
    const first = cipher.encrypt('{"password":"secreto"}', AAD);
    const second = cipher.encrypt('{"password":"secreto"}', AAD);
    expect(first).not.toBe(second);
    expect(first.startsWith('k1.')).toBe(true);
    expect(first).not.toContain('secreto');
    expect(cipher.decrypt(first, AAD)).toBe('{"password":"secreto"}');
  });

  it('falla si el texto cifrado se mueve a otra fila o tenant (AAD distinto)', () => {
    const cipher = new AesGcmSecretCipher(new Map([['k1', k1]]), 'k1');
    const payload = cipher.encrypt('dato', AAD);
    expect(() => cipher.decrypt(payload, 'tenant-b:email_provider:provider-1')).toThrow();
  });

  it('detecta cualquier manipulación (autenticación GCM)', () => {
    const cipher = new AesGcmSecretCipher(new Map([['k1', k1]]), 'k1');
    const [keyId, iv, tag, data] = cipher.encrypt('dato', AAD).split('.');
    const altered = Buffer.from(data ?? '', 'base64url');
    altered[0] = (altered[0] ?? 0) ^ 0xff;
    expect(() =>
      cipher.decrypt([keyId, iv, tag, altered.toString('base64url')].join('.'), AAD),
    ).toThrow();
  });

  it('rota claves: descifra con la antigua y cifra con la activa', () => {
    const before = new AesGcmSecretCipher(new Map([['k1', k1]]), 'k1');
    const legacy = before.encrypt('dato', AAD);
    const after = new AesGcmSecretCipher(
      new Map([
        ['k1', k1],
        ['k2', k2],
      ]),
      'k2',
    );
    expect(after.decrypt(legacy, AAD)).toBe('dato');
    expect(after.needsRotation(legacy)).toBe(true);
    expect(after.encrypt('dato', AAD).startsWith('k2.')).toBe(true);
    expect(() =>
      new AesGcmSecretCipher(new Map([['k2', k2]]), 'k2').decrypt(legacy, AAD),
    ).toThrow();
  });
});
