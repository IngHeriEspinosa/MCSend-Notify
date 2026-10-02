/**
 * Renderizado de bloques a HTML de correo (tablas e estilos en línea) y a texto plano.
 * Todo texto de usuario se protege (Liquid) y se escapa; las URL ya vienen validadas por Zod.
 */
import type {
  ColumnBlock,
  DocumentBlock,
  EmailBlock,
  ImageBlock,
} from '@/core/templates/email-content';
import type { DocumentAsset } from '@/core/templates/ports';
import type { TemplateIssue } from '@/core/templates/template-issues';
import { buttonTextColor, type TenantBranding } from '@/core/tenants/branding';
import { CONTENT_WIDTH, EMAIL_COLORS } from './email-layout';
import { EMAIL_STRINGS, type EmailLocale } from './email-strings';
import { escapeHtml, formatFileSize } from './html';
import type { LiquidProtector } from './liquid-engine';
import type { MarkdownRenderer } from './markdown-renderer';

export interface BlockRenderContext {
  locale: EmailLocale;
  branding: TenantBranding;
  documents: ReadonlyMap<string, DocumentAsset>;
  protector: LiquidProtector;
  markdown: MarkdownRenderer;
  report: (issue: TemplateIssue) => void;
}

export interface RenderedPart {
  html: string;
  text: string;
}

const SPACER_SIZES = { sm: 12, md: 24, lg: 40 } as const;
const COLUMN_GAP = 16;

/** Texto de usuario → HTML seguro conservando las variables Liquid. */
function userText(value: string, context: BlockRenderContext): string {
  return escapeHtml(context.protector.protect(value));
}

function button(label: string, url: string, align: 'left' | 'center', context: BlockRenderContext) {
  const { accent } = context.branding;
  const color = buttonTextColor(accent);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 8px 0 20px 0;"><tr><td align="${align}">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="mc-btn" bgcolor="${accent}" style="border-radius: 6px; background-color: ${accent};">
<a href="${userText(url, context)}" style="display: inline-block; padding: 12px 28px; font-weight: bold; font-size: 16px; color: ${color}; text-decoration: none; border-radius: 6px;">${userText(label, context)}</a>
</td></tr></table>
</td></tr></table>`;
}

function documentAsset(id: string, context: BlockRenderContext): DocumentAsset | null {
  const asset = context.documents.get(id);
  if (asset?.status === 'READY') return asset;
  context.report({
    code: 'DOCUMENT_UNAVAILABLE',
    severity: 'error',
    detail: asset?.title ?? id,
  });
  return null;
}

function unavailableBox(context: BlockRenderContext): string {
  return `<p style="margin: 0 0 16px 0; padding: 16px; border: 1px dashed ${EMAIL_COLORS.border}; color: ${EMAIL_COLORS.muted}; text-align: center;">${escapeHtml(EMAIL_STRINGS[context.locale].unavailable)}</p>`;
}

function renderImage(
  block: ImageBlock,
  maxWidth: number,
  context: BlockRenderContext,
): RenderedPart {
  const src = block.documentId
    ? (documentAsset(block.documentId, context)?.thumbnailUrl ?? null)
    : block.src;
  if (!src) return { html: unavailableBox(context), text: '' };
  const width = Math.min(block.width, maxWidth);
  const image = `<img src="${escapeHtml(src)}" alt="${userText(block.alt, context)}" width="${width}" style="display: block; width: 100%; max-width: ${width}px; height: auto;${block.align === 'center' ? ' margin: 0 auto;' : ''}">`;
  const linked = block.href ? `<a href="${userText(block.href, context)}">${image}</a>` : image;
  return {
    html: `<div style="margin: 0 0 16px 0;">${linked}</div>`,
    text: block.href ? `[${block.alt}] ${block.href}` : `[${block.alt}]`,
  };
}

function renderDocument(block: DocumentBlock, context: BlockRenderContext): RenderedPart {
  const asset = documentAsset(block.documentId, context);
  if (!asset) return { html: unavailableBox(context), text: '' };
  const strings = EMAIL_STRINGS[context.locale];
  const title = block.title ?? asset.title;
  const meta = [
    strings.kinds[asset.kind],
    asset.pageCount ? strings.pages(asset.pageCount, asset.kind) : null,
    formatFileSize(asset.sizeBytes, context.locale),
  ]
    .filter(Boolean)
    .join(' · ');
  const label = block.buttonLabel ?? strings.open(asset.kind);
  const height =
    asset.thumbnailWidth && asset.thumbnailHeight
      ? Math.round((CONTENT_WIDTH * asset.thumbnailHeight) / asset.thumbnailWidth)
      : null;
  const thumbnail = asset.thumbnailUrl
    ? `<tr><td style="padding: 0;"><a href="${escapeHtml(asset.downloadUrl)}"><img src="${escapeHtml(asset.thumbnailUrl)}" alt="${escapeHtml(strings.thumbnailAlt(title))}" width="${CONTENT_WIDTH}"${height ? ` height="${height}"` : ''} style="display: block; width: 100%; height: auto; border-bottom: 1px solid ${EMAIL_COLORS.border};"></a></td></tr>`
    : '';
  const description = block.description
    ? `<p style="margin: 0 0 12px 0;">${userText(block.description, context)}</p>`
    : '';
  const html = `<table role="presentation" class="mc-doc" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid ${EMAIL_COLORS.border}; margin: 8px 0 20px 0;">
${thumbnail}
<tr><td style="padding: 16px 20px 4px 20px;">
<p class="mc-doc-meta">${escapeHtml(meta)}</p>
<p class="mc-doc-title">${userText(title, context)}</p>
${description}
${button(label, asset.downloadUrl, 'left', context)}
</td></tr>
</table>`;
  const text = [`${title} (${meta})`, block.description, `${label}: ${asset.downloadUrl}`]
    .filter(Boolean)
    .join('\n');
  return { html, text };
}

function renderSimple(
  block: EmailBlock | ColumnBlock,
  maxWidth: number,
  context: BlockRenderContext,
): RenderedPart {
  switch (block.type) {
    case 'heading': {
      const tag = block.level === 1 ? 'h1' : 'h2';
      return {
        html: `<${tag} style="text-align: ${block.align};">${userText(block.text, context)}</${tag}>`,
        text: block.text,
      };
    }
    case 'text': {
      const { html, findings } = context.markdown.render(
        context.protector.protect(block.markdown),
        context.protector,
      );
      if (findings.imagesWithoutAlt > 0) {
        context.report({ code: 'IMAGE_MISSING_ALT', severity: 'warning' });
      }
      if (findings.insecureLinks > 0)
        context.report({ code: 'INSECURE_LINK', severity: 'warning' });
      return { html, text: block.markdown };
    }
    case 'button':
      if (block.url.startsWith('http://')) {
        context.report({ code: 'INSECURE_LINK', severity: 'warning' });
      }
      return {
        html: button(block.label, block.url, block.align, context),
        text: `${block.label}: ${block.url}`,
      };
    case 'image':
      return renderImage(block, maxWidth, context);
    case 'divider':
      return {
        html: `<hr style="border: 0; border-top: 1px solid ${EMAIL_COLORS.border}; margin: 24px 0;">`,
        text: '----',
      };
    case 'spacer': {
      const size = SPACER_SIZES[block.size];
      return {
        html: `<div style="height: ${size}px; line-height: ${size}px; font-size: 1px;">&nbsp;</div>`,
        text: '',
      };
    }
    case 'document':
      return renderDocument(block, context);
    case 'columns': {
      const width = Math.floor((CONTENT_WIDTH - COLUMN_GAP) / 2);
      const column = (blocks: ColumnBlock[]) =>
        blocks.map((item) => renderSimple(item, width, context));
      const left = column(block.left);
      const right = column(block.right);
      return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 8px 0;"><tr>
<td class="mc-col" width="50%" valign="top" style="padding-right: ${COLUMN_GAP / 2}px;">${left.map((part) => part.html).join('\n')}</td>
<td class="mc-col" width="50%" valign="top" style="padding-left: ${COLUMN_GAP / 2}px;">${right.map((part) => part.html).join('\n')}</td>
</tr></table>`,
        text: [...left, ...right]
          .map((part) => part.text)
          .filter(Boolean)
          .join('\n\n'),
      };
    }
  }
}

export function renderBlocks(
  blocks: readonly EmailBlock[],
  context: BlockRenderContext,
): RenderedPart {
  const parts = blocks.map((block) => renderSimple(block, CONTENT_WIDTH, context));
  return {
    html: parts.map((part) => part.html).join('\n'),
    text: parts
      .map((part) => part.text)
      .filter(Boolean)
      .join('\n\n'),
  };
}
