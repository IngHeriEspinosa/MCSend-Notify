/**
 * Protección SSRF para conexiones salientes a hosts configurados por usuarios (servidores SMTP) o
 * indicados en mensajes externos (certificados y confirmaciones de SNS).
 *
 * Resuelve el nombre y rechaza direcciones privadas, de loopback, link-local (incluidos los
 * metadatos de nube 169.254.169.254), CGNAT, multicast y las IPv6 equivalentes, salvo que
 * `SSRF_ALLOW_PRIVATE` esté activo (desarrollo con Mailpit en la red de Docker).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function ipv4ToNumber(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const value = ipv4ToNumber(address);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (value & mask) === (ipv4ToNumber(base) & mask);
    });
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff')
  );
}

export class BlockedHostError extends Error {
  constructor(host: string) {
    super(`El host ${host} resuelve a una dirección privada o reservada`);
    this.name = 'BlockedHostError';
  }
}

/** Lanza BlockedHostError si alguna dirección del host es privada (y no se permite). */
export async function assertPublicHost(host: string, allowPrivate: boolean): Promise<void> {
  if (allowPrivate) return;
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new BlockedHostError(host);
  }
}
