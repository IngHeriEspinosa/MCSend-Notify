/**
 * Markdown → HTML para correos con markdown-it en modo seguro:
 * - Sin HTML embebido (`html: false`): cualquier etiqueta se muestra como texto.
 * - Enlaces solo http(s), mailto o las variables de sistema de baja/preferencias.
 * - Imágenes solo por https.
 */
import markdownIt, { type MarkdownIt } from 'markdown-it';
import { isAllowedLinkUrl } from '@/core/templates/email-content';
import type { LiquidProtector } from './liquid-engine';

export interface MarkdownFindings {
  imagesWithoutAlt: number;
  insecureLinks: number;
}

export class MarkdownRenderer {
  private readonly md: MarkdownIt;
  private protector: LiquidProtector | null = null;
  private findings: MarkdownFindings = { imagesWithoutAlt: 0, insecureLinks: 0 };

  constructor() {
    this.md = markdownIt({ html: false, linkify: true, breaks: true, typographer: false });
    this.md.validateLink = (url) => this.isAllowed(url);

    const defaultImage = this.md.renderer.rules.image;
    this.md.renderer.rules.image = (tokens, index, options, env, self) => {
      const token = tokens[index];
      const src = String(token?.attrGet('src') ?? '');
      if (!token || !src.startsWith('https://')) return '';
      if (token.content.trim() === '') this.findings.imagesWithoutAlt += 1;
      return defaultImage
        ? defaultImage(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options);
    };

    const defaultLinkOpen = this.md.renderer.rules.link_open;
    this.md.renderer.rules.link_open = (tokens, index, options, env, self) => {
      const href = String(tokens[index]?.attrGet('href') ?? '');
      if (href.startsWith('http://')) this.findings.insecureLinks += 1;
      return defaultLinkOpen
        ? defaultLinkOpen(tokens, index, options, env, self)
        : self.renderToken(tokens, index, options);
    };
  }

  private isAllowed(url: string): boolean {
    const tag = this.protector?.tagAt(url);
    if (tag !== null && tag !== undefined) return isAllowedLinkUrl(tag);
    return isAllowedLinkUrl(url.trim());
  }

  /** Renderiza Markdown cuyo texto ya pasó por `protector.protect`. */
  render(
    markdown: string,
    protector: LiquidProtector,
  ): { html: string; findings: MarkdownFindings } {
    this.protector = protector;
    this.findings = { imagesWithoutAlt: 0, insecureLinks: 0 };
    try {
      const html = this.md.render(markdown);
      return { html, findings: this.findings };
    } finally {
      this.protector = null;
    }
  }
}
