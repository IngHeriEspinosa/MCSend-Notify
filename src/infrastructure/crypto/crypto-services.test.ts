import { describe, expect, it } from 'vitest';
import {
  Argon2PasswordHasher,
  RandomSecretTokenService,
  Sha256ApiKeyCodec,
  sha256Hex,
} from './crypto-services';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('usa argon2id y verifica la contraseña correcta', async () => {
    const hash = await hasher.hash('una-clave-muy-segura');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(hash, 'una-clave-muy-segura')).toBe(true);
    expect(await hasher.verify(hash, 'otra-clave')).toBe(false);
  });

  it('devuelve false ante un hash corrupto en lugar de lanzar', async () => {
    expect(await hasher.verify('no-es-un-hash', 'x')).toBe(false);
  });
});

describe('RandomSecretTokenService', () => {
  it('genera tokens distintos y guarda solo su SHA-256', () => {
    const service = new RandomSecretTokenService();
    const first = service.generate();
    const second = service.generate();
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toBe(sha256Hex(first.token));
    expect(first.hash).not.toContain(first.token);
  });
});

describe('Sha256ApiKeyCodec', () => {
  const codec = new Sha256ApiKeyCodec();

  it('genera claves con prefijo visible y hash verificable', () => {
    const { key, prefix, hash } = codec.generate();
    expect(key).toMatch(/^mcsn_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{32}$/);
    expect(key.startsWith(`mcsn_${prefix}_`)).toBe(true);
    expect(codec.hash(key)).toBe(hash);
  });

  it('rechaza formatos inválidos sin calcular hash', () => {
    expect(codec.hash('Bearer abc')).toBeNull();
    expect(codec.hash('mcsn_corto_x')).toBeNull();
  });
});
