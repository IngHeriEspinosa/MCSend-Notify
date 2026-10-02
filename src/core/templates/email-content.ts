/**
 * Contenido de una plantilla de correo validado con Zod.
 *
 * Tres formatos:
 * - BLOCKS: bloques estructurados (titular, texto Markdown, botón, imagen, documento...).
 * - MARKDOWN: un único texto en Markdown (sin HTML).
 * - HTML: HTML propio; se sanea con una lista blanca antes de usarse.
 *
 * Los textos admiten variables Liquid (`{{ contact.first_name }}`). En las URL solo se admiten
 * enlaces http(s), mailto y las variables de sistema de baja y preferencias: una variable con
 * datos del contacto en un `href` permitiría inyectar `javascript:` u open redirects.
 */
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '@/core/tenants/tenant';

export const TEMPLATE_FORMATS = ['BLOCKS', 'MARKDOWN', 'HTML'] as const;
export type TemplateFormat = (typeof TEMPLATE_FORMATS)[number];

export const MAX_BLOCKS = 60;
export const MAX_COLUMN_BLOCKS = 6;
export const MAX_MARKDOWN_LENGTH = 50_000;
export const MAX_HTML_LENGTH = 200_000;

const SYSTEM_LINK_VARIABLE = /^\{\{\s*(unsubscribe_url|preferences_url)\s*\}\}$/;

export function isAllowedLinkUrl(value: string): boolean {
  if (SYSTEM_LINK_VARIABLE.test(value)) return true;
  if (value.startsWith('mailto:')) return /^mailto:[^\s<>"']+@[^\s<>"']+$/.test(value);
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '';
  } catch {
    return false;
  }
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const linkUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(isAllowedLinkUrl, { message: 'INVALID_URL' });

const blockId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const align = z.enum(['left', 'center']);

export const headingBlockSchema = z.object({
  id: blockId,
  type: z.literal('heading'),
  text: z.string().trim().min(1).max(200),
  level: z.union([z.literal(1), z.literal(2)]),
  align: align.default('left'),
});

export const textBlockSchema = z.object({
  id: blockId,
  type: z.literal('text'),
  markdown: z.string().max(20_000),
});

export const buttonBlockSchema = z.object({
  id: blockId,
  type: z.literal('button'),
  label: z.string().trim().min(1).max(80),
  url: linkUrlSchema,
  align: align.default('center'),
});

/** Imagen externa (https) o subida como documento de tipo imagen. El texto alternativo es obligatorio. */
export const imageBlockSchema = z
  .object({
    id: blockId,
    type: z.literal('image'),
    src: z.string().trim().max(2000).nullable().default(null),
    documentId: z.uuid().nullable().default(null),
    alt: z.string().trim().min(1).max(200),
    href: linkUrlSchema.nullable().default(null),
    width: z.number().int().min(80).max(600).default(600),
    align: align.default('center'),
  })
  .refine((block) => (block.src === null) !== (block.documentId === null), {
    message: 'IMAGE_SOURCE_REQUIRED',
    path: ['src'],
  })
  .refine((block) => block.src === null || isHttpsUrl(block.src), {
    message: 'INVALID_URL',
    path: ['src'],
  });

export const dividerBlockSchema = z.object({ id: blockId, type: z.literal('divider') });

export const spacerBlockSchema = z.object({
  id: blockId,
  type: z.literal('spacer'),
  size: z.enum(['sm', 'md', 'lg']).default('md'),
});

/** Tarjeta de documento: miniatura enlazada, título, tipo y páginas, y botón de descarga. */
export const documentBlockSchema = z.object({
  id: blockId,
  type: z.literal('document'),
  documentId: z.uuid(),
  title: z.string().trim().max(200).nullable().default(null),
  description: z.string().trim().max(300).nullable().default(null),
  buttonLabel: z.string().trim().max(60).nullable().default(null),
});

const columnBlockSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  textBlockSchema,
  buttonBlockSchema,
  imageBlockSchema,
]);

export const columnsBlockSchema = z.object({
  id: blockId,
  type: z.literal('columns'),
  left: z.array(columnBlockSchema).max(MAX_COLUMN_BLOCKS),
  right: z.array(columnBlockSchema).max(MAX_COLUMN_BLOCKS),
});

export const emailBlockSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  textBlockSchema,
  buttonBlockSchema,
  imageBlockSchema,
  dividerBlockSchema,
  spacerBlockSchema,
  documentBlockSchema,
  columnsBlockSchema,
]);

export type EmailBlock = z.infer<typeof emailBlockSchema>;
export type ColumnBlock = z.infer<typeof columnBlockSchema>;
export type EmailBlockType = EmailBlock['type'];
export type ImageBlock = z.infer<typeof imageBlockSchema>;
export type DocumentBlock = z.infer<typeof documentBlockSchema>;

export const blocksContentSchema = z.object({
  blocks: z.array(emailBlockSchema).max(MAX_BLOCKS),
});

export const markdownContentSchema = z.object({
  markdown: z.string().max(MAX_MARKDOWN_LENGTH),
});

export const htmlContentSchema = z.object({ html: z.string().max(MAX_HTML_LENGTH) });

const messageFields = {
  subject: z.string().trim().min(1).max(200),
  preheader: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value === '' ? null : value))
    .nullable(),
  locale: z.enum(SUPPORTED_LOCALES),
};

/** Cuerpo de una plantilla: formato, asunto, preencabezado, idioma y contenido. */
export const templateBodySchema = z.discriminatedUnion('format', [
  z.object({ ...messageFields, format: z.literal('BLOCKS'), content: blocksContentSchema }),
  z.object({ ...messageFields, format: z.literal('MARKDOWN'), content: markdownContentSchema }),
  z.object({ ...messageFields, format: z.literal('HTML'), content: htmlContentSchema }),
]);

export type TemplateBody = z.infer<typeof templateBodySchema>;

/** Documentos referenciados por la plantilla (tarjetas e imágenes subidas). */
export function referencedDocumentIds(body: TemplateBody): string[] {
  if (body.format !== 'BLOCKS') return [];
  const ids = new Set<string>();
  const visit = (block: EmailBlock | ColumnBlock) => {
    if (block.type === 'document') ids.add(block.documentId);
    if (block.type === 'image' && block.documentId) ids.add(block.documentId);
    if (block.type === 'columns') [...block.left, ...block.right].forEach(visit);
  };
  body.content.blocks.forEach(visit);
  return [...ids];
}

/** Contenido inicial de una plantilla nueva según el formato elegido. */
export function emptyTemplateBody(format: TemplateFormat, locale: 'es' | 'en'): TemplateBody {
  const common = { subject: '', preheader: null, locale };
  switch (format) {
    case 'BLOCKS':
      return { ...common, format, content: { blocks: [] } };
    case 'MARKDOWN':
      return { ...common, format, content: { markdown: '' } };
    case 'HTML':
      return { ...common, format, content: { html: '' } };
  }
}
