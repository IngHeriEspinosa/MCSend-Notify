/**
 * Cliente HTTP con protección SSRF (OWASP A10) para URL que indican los usuarios: páginas y feeds
 * fuente de la IA y servidores de modelos compatibles con OpenAI.
 *
 * - Solo http/https, sin credenciales en la URL y con lista de puertos permitidos.
 * - El nombre se resuelve una vez y la conexión usa esa misma IP (`lookup` fijado): un DNS que
 *   cambie de respuesta entre la comprobación y la conexión (rebinding) no puede saltarse el filtro.
 * - Bloquea IP privadas, loopback, link-local, CGNAT y multicast salvo `allowPrivate`; las de
 *   metadatos de nube se bloquean siempre.
 * - Cada redirección se valida de nuevo (máximo 3). Límite de tiempo y de tamaño, también tras
 *   descomprimir, y lista de tipos de contenido aceptados.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { isPrivateAddress } from './network-guard';

/** Metadatos de nube (AWS, GCP, Azure, Alibaba): nunca accesibles, ni en desarrollo. */
const ALWAYS_BLOCKED = new Set(['169.254.169.254', 'fd00:ec2::254', '100.100.100.200']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'MCSendNotify/1.0 (+https://multicomputos.com)';

export const SAFE_FETCH_ERROR_CODES = [
  'BLOCKED',
  'TIMEOUT',
  'TOO_LARGE',
  'REDIRECTS',
  'UNSUPPORTED',
  'NETWORK',
] as const;
export type SafeFetchErrorCode = (typeof SAFE_FETCH_ERROR_CODES)[number];

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowPrivate?: boolean;
  /** Puertos permitidos; `any` para servidores propios (p. ej. Ollama en 11434). */
  ports?: readonly number[] | 'any';
  /** Prefijos de Content-Type aceptados (vacío = cualquiera). */
  accept?: readonly string[];
}

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export function isBlockedAddress(address: string, allowPrivate: boolean): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (ALWAYS_BLOCKED.has(normalized)) return true;
  return !allowPrivate && isPrivateAddress(address);
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** `lookup` para http.request que valida todas las direcciones y fija la conexión a ellas. */
function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    dnsLookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        callback(error, []);
        return;
      }
      if (
        addresses.length === 0 ||
        addresses.some((entry) => isBlockedAddress(entry.address, allowPrivate))
      ) {
        callback(new SafeFetchError('BLOCKED', `Host bloqueado: ${hostname}`), []);
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      const [first] = addresses;
      callback(null, first?.address ?? '', first?.family);
    });
  };
}

function validateUrl(raw: string, options: SafeFetchOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('UNSUPPORTED', 'URL no válida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('UNSUPPORTED', 'Solo se admiten http y https');
  }
  if (url.username || url.password) {
    throw new SafeFetchError('UNSUPPORTED', 'La URL no puede llevar credenciales');
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const ports = options.ports ?? [80, 443];
  if (ports !== 'any' && !ports.includes(port)) {
    throw new SafeFetchError('BLOCKED', `Puerto no permitido: ${port}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host, options.allowPrivate ?? false)) {
    throw new SafeFetchError('BLOCKED', `Dirección bloqueada: ${host}`);
  }
  return url;
}

function decode(response: IncomingMessage): Readable {
  switch (String(response.headers['content-encoding'] ?? '').toLowerCase()) {
    case 'gzip':
      return response.pipe(createGunzip());
    case 'deflate':
      return response.pipe(createInflate());
    case 'br':
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

function once(url: URL, options: SafeFetchOptions, deadline: number): Promise<SafeResponse> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<SafeResponse>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new SafeFetchError('TIMEOUT', 'Tiempo de espera agotado'));
      return;
    }
    const request = send(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          'user-agent': USER_AGENT,
          'accept-encoding': 'gzip, deflate, br',
          ...options.headers,
        },
        lookup: guardedLookup(options.allowPrivate ?? false),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
        if (REDIRECT_STATUSES.has(status)) {
          response.resume();
          resolve({
            url: url.toString(),
            status,
            contentType,
            headers: response.headers,
            body: Buffer.alloc(0),
          });
          return;
        }
        const declared = Number(response.headers['content-length'] ?? '0');
        if (declared > maxBytes) {
          response.destroy();
          reject(new SafeFetchError('TOO_LARGE', 'Respuesta demasiado grande'));
          return;
        }
        if (
          status < 400 &&
          options.accept &&
          options.accept.length > 0 &&
          !options.accept.some((prefix) => contentType.startsWith(prefix))
        ) {
          response.destroy();
          reject(
            new SafeFetchError('UNSUPPORTED', `Tipo de contenido no admitido: ${contentType}`),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = decode(response);
        stream.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            stream.destroy();
            response.destroy();
            reject(new SafeFetchError('TOO_LARGE', 'Respuesta demasiado grande'));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () =>
          resolve({
            url: url.toString(),
            status,
            contentType,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        stream.on('error', (error) => reject(new SafeFetchError('NETWORK', error.message)));
      },
    );
    request.setTimeout(remaining, () =>
      request.destroy(new SafeFetchError('TIMEOUT', 'Tiempo de espera agotado')),
    );
    request.on('error', (error) =>
      reject(
        error instanceof SafeFetchError ? error : new SafeFetchError('NETWORK', error.message),
      ),
    );
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  let url = validateUrl(rawUrl, options);
  let current: SafeFetchOptions = { ...options };
  for (let redirects = 0; ; redirects += 1) {
    const response = await once(url, current, deadline);
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirects >= (options.maxRedirects ?? 3)) {
      throw new SafeFetchError('REDIRECTS', 'Demasiadas redirecciones');
    }
    const location = response.headers.location;
    if (typeof location !== 'string') return response;
    const next = validateUrl(new URL(location, url).toString(), options);
    if (next.origin !== url.origin) {
      // Las credenciales (clave de API) nunca viajan a otro origen.
      const { authorization: _auth, Authorization: _Auth, ...headers } = current.headers ?? {};
      current = { ...current, headers };
    }
    const toGet =
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && current.method === 'POST');
    if (toGet) {
      const { body: _body, ...rest } = current;
      current = { ...rest, method: 'GET' };
    }
    url = next;
  }
}
