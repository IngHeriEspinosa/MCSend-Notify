/**
 * Puertos transversales del dominio. Las implementaciones viven en src/infrastructure.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface IdGenerator {
  uuid(): string;
}

/** Contenido binario en flujo, independiente de la plataforma. */
export type ByteStream = AsyncIterable<Uint8Array>;

/** Almacenamiento de objetos (S3 compatible). Las claves las genera siempre el sistema. */
export interface ObjectStorage {
  put(key: string, body: Uint8Array | ByteStream, contentType: string): Promise<void>;
  getStream(key: string): Promise<ByteStream>;
  getBytes(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

/** Tokens aleatorios de un solo uso (invitaciones) y su hash para persistirlos. */
export interface SecretTokenService {
  generate(): { token: string; hash: string };
  hash(token: string): string;
}
