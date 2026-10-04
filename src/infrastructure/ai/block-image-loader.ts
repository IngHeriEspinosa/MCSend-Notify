/**
 * Imagen de un bloque para generar su texto alternativo.
 *
 * - Documento de la biblioteca: se usa su miniatura (JPEG ya procesado y sin metadatos).
 * - URL externa: solo https, con `safeFetch` (sin red privada ni DNS rebinding), 5 MB como
 *   máximo y tipos de imagen rasterizada (sin SVG: puede contener scripts y referencias).
 *
 * La imagen se reescala a 1568 px como máximo (lo que aprovechan los modelos de visión) y se
 * convierte a JPEG sin metadatos; nunca se guarda.
 */
import sharp from 'sharp';
import type { AiImage, ImageLoader } from '@/core/ai/ports';
import type { DocumentRecord } from '@/core/documents/document';
import { DomainError } from '@/core/shared/domain-error';
import type { ObjectStorage } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { SafeFetchError, safeFetch } from '../security/safe-fetch';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 50_000_000;
const MAX_EDGE = 1568;
const RASTER_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
const RASTER_FORMATS = new Set(['jpeg', 'png', 'gif', 'webp']);

function unavailable(message: string): DomainError {
  return new DomainError('VALIDATION', message, { reason: 'IMAGE_UNAVAILABLE' });
}

export class BlockImageLoader implements ImageLoader {
  constructor(
    private readonly deps: {
      documents: {
        findById(
          context: TenantContext,
          documentId: string,
        ): Promise<Pick<DocumentRecord, 'status' | 'thumbnailKey'> | null>;
      };
      storage: Pick<ObjectStorage, 'getBytes'>;
      allowPrivateHosts: boolean;
    },
  ) {}

  async load(
    context: TenantContext,
    source: { src: string | null; documentId: string | null },
  ): Promise<AiImage> {
    const bytes = source.documentId
      ? await this.fromDocument(context, source.documentId)
      : await this.fromUrl(source.src ?? '');
    return this.normalize(bytes);
  }

  private async fromDocument(context: TenantContext, documentId: string): Promise<Uint8Array> {
    const document = await this.deps.documents.findById(context, documentId);
    if (!document || document.status !== 'READY' || !document.thumbnailKey) {
      throw unavailable('El documento no tiene una imagen disponible');
    }
    return this.deps.storage.getBytes(document.thumbnailKey);
  }

  private async fromUrl(src: string): Promise<Uint8Array> {
    if (!src.startsWith('https://')) throw unavailable('La imagen debe estar en una URL https');
    try {
      const response = await safeFetch(src, {
        maxBytes: MAX_BYTES,
        timeoutMs: 15_000,
        accept: RASTER_TYPES,
        allowPrivate: this.deps.allowPrivateHosts,
      });
      if (response.status !== 200) throw unavailable(`La imagen respondió HTTP ${response.status}`);
      return new Uint8Array(response.body);
    } catch (error) {
      if (error instanceof SafeFetchError)
        throw unavailable(`No se pudo descargar la imagen: ${error.code}`);
      throw error;
    }
  }

  private async normalize(bytes: Uint8Array): Promise<AiImage> {
    // El Content-Type lo declara el servidor remoto: se comprueba el formato real antes de
    // decodificar (un SVG o un PDF disfrazados de PNG no llegan a procesarse).
    const format = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .metadata()
      .then((metadata) => metadata.format)
      .catch(() => undefined);
    if (!format || !RASTER_FORMATS.has(format)) {
      throw unavailable('El archivo no es una imagen JPEG, PNG, GIF o WebP');
    }
    try {
      const data = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85 })
        .toBuffer();
      return { mediaType: 'image/jpeg', base64: data.toString('base64') };
    } catch {
      throw unavailable('El archivo no es una imagen válida');
    }
  }
}
