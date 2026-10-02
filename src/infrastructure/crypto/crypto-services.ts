/**
 * Servicios criptográficos:
 * - Contraseñas con argon2id (parámetros mínimos de OWASP: 19 MiB, 2 iteraciones, 1 hilo).
 * - Tokens de un solo uso (invitaciones): 32 bytes aleatorios; se persiste su SHA-256.
 * - Claves de API `mcsn_{prefijo}_{secreto}`: se persiste el SHA-256 de la clave completa
 *   (alta entropía, por lo que no necesita un hash lento).
 */
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { ApiKeyCodec } from '@/core/api-keys/api-keys';
import type { PasswordHasher } from '@/core/identity/ports';
import type { ContentHasher, IdGenerator, SecretTokenService } from '@/core/shared/ports';

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return argonHash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argonVerify(passwordHash, password);
    } catch {
      return false; // Hash corrupto o con formato desconocido.
    }
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class RandomSecretTokenService implements SecretTokenService {
  generate() {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return sha256Hex(token);
  }
}

const API_KEY_PATTERN = /^mcsn_([A-Za-z0-9_-]{8})_([A-Za-z0-9_-]{32})$/;

export class Sha256ApiKeyCodec implements ApiKeyCodec {
  generate() {
    const prefix = randomBytes(6).toString('base64url');
    const secret = randomBytes(24).toString('base64url');
    const key = `mcsn_${prefix}_${secret}`;
    return { key, prefix, hash: sha256Hex(key) };
  }

  hash(key: string): string | null {
    return API_KEY_PATTERN.test(key) ? sha256Hex(key) : null;
  }
}

export const cryptoIdGenerator: IdGenerator = { uuid: () => crypto.randomUUID() };

export const sha256ContentHasher: ContentHasher = {
  sha256: (bytes) => createHash('sha256').update(bytes).digest('hex'),
};
