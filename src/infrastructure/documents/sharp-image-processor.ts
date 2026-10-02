/**
 * Procesado de imágenes con sharp (libvips): miniaturas JPEG y logotipos PNG.
 * Se eliminan los metadatos (EXIF con ubicación, autor...) y se limita el número de píxeles
 * de entrada para evitar bombas de descompresión.
 */
import sharp from 'sharp';
import { DocumentProcessingError } from '@/core/documents/document';
import type { ImageProcessor, ProcessedImage } from '@/core/documents/ports';

const MAX_INPUT_PIXELS = 100_000_000;

export class SharpImageProcessor implements ImageProcessor {
  async thumbnail(bytes: Uint8Array, width: number): Promise<ProcessedImage> {
    try {
      const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 80, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      return {
        bytes: new Uint8Array(data),
        width: info.width,
        height: info.height,
        contentType: 'image/jpeg',
      };
    } catch (error) {
      throw new DocumentProcessingError('INVALID_FILE', 'No se pudo generar la miniatura', {
        cause: error,
      });
    }
  }

  async normalizeLogo(bytes: Uint8Array): Promise<ProcessedImage> {
    try {
      const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: 480, height: 160, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      return {
        bytes: new Uint8Array(data),
        width: info.width,
        height: info.height,
        contentType: 'image/png',
      };
    } catch (error) {
      throw new DocumentProcessingError('INVALID_FILE', 'No se pudo procesar el logotipo', {
        cause: error,
      });
    }
  }
}
