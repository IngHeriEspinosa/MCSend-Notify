/**
 * Saneado del HTML propio de las plantillas con lista blanca (OWASP A03, XSS):
 * - Sin scripts, formularios, iframes, objetos, SVG ni manejadores `on*`.
 * - Enlaces solo http(s), mailto o variables de sistema; imágenes solo https.
 * - Estilos en línea filtrados por propiedad; se rechazan `url()`, `expression()` e `@import`.
 * Antes de sanear, los estilos de `<style>` se aplican en línea con juice (los clientes de correo
 * ignoran muchas hojas de estilo y el saneador las elimina).
 */
import juice from 'juice';
import sanitizeHtml from 'sanitize-html';
import { isAllowedLinkUrl } from '@/core/templates/email-content';
import type { LiquidProtector } from './liquid-engine';

const ALLOWED_TAGS = [
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'center',
  'code',
  'col',
  'colgroup',
  'div',
  'em',
  'figcaption',
  'figure',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'section',
  'article',
  'header',
  'footer',
];

/** Etiquetas de estructura que se descartan sin considerarse contenido peligroso. */
const STRUCTURAL_TAGS = new Set(['html', 'head', 'body', 'meta', 'title', 'style', 'link']);

const SAFE_CSS_VALUE =
  /^(?!.*(?:url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding)).*$/i;

const STYLE_PROPERTIES = [
  'background-color',
  'border',
  'border-bottom',
  'border-collapse',
  'border-color',
  'border-left',
  'border-radius',
  'border-right',
  'border-spacing',
  'border-style',
  'border-top',
  'border-width',
  'color',
  'display',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'height',
  'letter-spacing',
  'line-height',
  'list-style-type',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'opacity',
  'overflow',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-transform',
  'vertical-align',
  'white-space',
  'width',
  'word-break',
  'word-wrap',
];

const ALLOWED_STYLES = {
  '*': Object.fromEntries(STYLE_PROPERTIES.map((property) => [property, [SAFE_CSS_VALUE]])),
};

const COMMON_ATTRIBUTES = [
  'style',
  'class',
  'align',
  'valign',
  'width',
  'height',
  'bgcolor',
  'dir',
  'lang',
  'title',
  'role',
  'aria-label',
  'aria-hidden',
  'border',
  'cellpadding',
  'cellspacing',
  'colspan',
  'rowspan',
];

export interface SanitizeResult {
  html: string;
  /** Se eliminó algo distinto de la estructura del documento (scripts, eventos, enlaces...). */
  removedUnsafeContent: boolean;
  imagesWithoutAlt: number;
  insecureLinks: number;
}

/** Sanea HTML ya protegido con `LiquidProtector` (los marcadores sobreviven al saneado). */
export function sanitizeEmailHtml(source: string, protector: LiquidProtector): SanitizeResult {
  let removedUnsafeContent = false;
  let imagesWithoutAlt = 0;
  let insecureLinks = 0;
  const allowedTags = new Set(ALLOWED_TAGS);

  const inlined = juice(source, {
    removeStyleTags: true,
    preserveMediaQueries: false,
    applyWidthAttributes: true,
    applyHeightAttributes: false,
  });

  const html = sanitizeHtml(inlined, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': COMMON_ATTRIBUTES,
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      font: ['color', 'face', 'size'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    allowedStyles: ALLOWED_STYLES,
    disallowedTagsMode: 'discard',
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head'],
    onOpenTag: (name, attributes) => {
      if (!allowedTags.has(name) && !STRUCTURAL_TAGS.has(name)) removedUnsafeContent = true;
      if (Object.keys(attributes).some((attribute) => attribute.toLowerCase().startsWith('on'))) {
        removedUnsafeContent = true;
      }
      if (name === 'img' && attributes.alt === undefined) imagesWithoutAlt += 1;
      if (name === 'a' && attributes.href?.startsWith('http://')) insecureLinks += 1;
    },
    transformTags: {
      a: (tagName, attributes) => {
        const href = attributes.href ?? '';
        const tag = protector.tagAt(href);
        const allowed =
          tag !== null ? isAllowedLinkUrl(tag) : href === '' || isAllowedLinkUrl(href);
        if (!allowed) removedUnsafeContent = true;
        const { href: _removed, ...rest } = attributes;
        return { tagName, attribs: allowed && href !== '' ? { ...rest, href } : rest };
      },
    },
  });

  return { html, removedUnsafeContent, imagesWithoutAlt, insecureLinks };
}

/** Texto plano a partir de HTML (versión alternativa del correo). */
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table|blockquote|section|article|header|footer)>/gi, '\n')
    .replace(
      /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, text: string) => (href && href !== text ? `${text} (${href})` : text),
    );
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
}
