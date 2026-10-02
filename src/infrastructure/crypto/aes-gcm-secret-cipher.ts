/**
 * Cifrado autenticado AES-256-GCM de secretos en reposo con rotación de claves.
 *
 * Formato: `{keyId}.{iv}.{tag}.{ciphertext}` (base64url). El IV es aleatorio de 12 bytes y el AAD
 * liga el texto cifrado a su fila (`tenant:tabla:id`): moverlo a otra fila o a otro tenant hace
 * fallar la verificación. Se cifra siempre con la clave activa y se descifra con la indicada en
 * el propio texto, de modo que las claves antiguas siguen sirviendo hasta re-cifrar
 * (`pnpm secrets:rotate`).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretCipher } from '@/core/shared/ports';

const IV_BYTES = 12;

export class AesGcmSecretCipher implements SecretCipher {
  constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    private readonly activeKeyId: string,
  ) {
    if (!keys.has(activeKeyId)) throw new Error('La clave activa no existe');
  }

  encrypt(plaintext: string, aad: string): string {
    const key = this.keys.get(this.activeKeyId);
    if (!key) throw new Error('Clave de cifrado no disponible');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      this.activeKeyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string, aad: string): string {
    const [keyId, iv, tag, ciphertext] = payload.split('.');
    const key = keyId ? this.keys.get(keyId) : undefined;
    if (!key || !iv || !tag || ciphertext === undefined) {
      throw new Error('Secreto cifrado con formato o clave desconocidos');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Indica si el secreto está cifrado con una clave distinta de la activa (para rotar). */
  needsRotation(payload: string): boolean {
    return payload.split('.')[0] !== this.activeKeyId;
  }
}
