/**
 * Compilador de correos: plantilla (bloques, Markdown o HTML) + branding del tenant → HTML con
 * estilos en línea y versión de texto, más las comprobaciones previas al envío.
 *
 * `prepare` se ejecuta una vez por envío y deja las variables Liquid pendientes;
 * `personalize` las sustituye para cada destinatario (escape HTML en el cuerpo).
 */
import juice from 'juice';
import { DomainError } from '@/core/shared/domain-error';
import type {
  EmailCompiler,
  PrepareEmailInput,
  PreparedEmail,
  RenderedEmail,
} from '@/core/templates/ports';
import {
  GMAIL_CLIP_BYTES,
  SUBJECT_RECOMMENDED_MAX,
  type TemplateIssue,
} from '@/core/templates/template-issues';
import { isKnownVariable, type RecipientVariables } from '@/core/templates/template-variables';
import { renderBlocks, type RenderedPart } from './block-renderer';
import { buildEmailDocument } from './email-layout';
import { htmlToPlainText, sanitizeEmailHtml } from './email-sanitizer';
import { EMAIL_STRINGS } from './email-strings';
import { decodeEntities, escapeHtml, utf8Bytes } from './html';
import { LiquidEngine, LiquidProtector } from './liquid-engine';
import { MarkdownRenderer } from './markdown-renderer';

class IssueCollector {
  private readonly issues = new Map<string, TemplateIssue>();

  add = (issue: TemplateIssue): void => {
    const key = `${issue.code}:${issue.detail ?? ''}`;
    if (!this.issues.has(key)) this.issues.set(key, issue);
  };

  list(): TemplateIssue[] {
    return [...this.issues.values()].sort(
      (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'),
    );
  }
}

export class HtmlEmailCompiler implements EmailCompiler {
  constructor(
    private readonly liquid: LiquidEngine = new LiquidEngine(),
    private readonly markdown: MarkdownRenderer = new MarkdownRenderer(),
  ) {}

  async prepare(input: PrepareEmailInput): Promise<PreparedEmail> {
    const protector = new LiquidProtector();
    const issues = new IssueCollector();
    const { body, sender } = input;

    const content = this.renderContent(input, protector, issues.add);
    const footer = this.renderFooter(input, protector, issues.add);

    const document = buildEmailDocument({
      locale: body.locale,
      title: escapeHtml(protector.protect(body.subject)),
      preheader: body.preheader ? escapeHtml(protector.protect(body.preheader)) : null,
      contentHtml: content.html,
      footerHtml: footer.html,
      branding: sender.branding,
      tenantName: sender.tenantName,
      logoUrl: sender.logoUrl,
      forceColorScheme: input.forceColorScheme,
    });
    const html = protector.restore(
      juice(document, {
        removeStyleTags: true,
        preserveMediaQueries: true,
        preserveImportant: true,
        applyWidthAttributes: true,
        applyHeightAttributes: false,
      }),
    );
    const text = [body.preheader, content.text, footer.text]
      .filter((part): part is string => Boolean(part))
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    this.checkMessage(input, issues.add);
    this.checkVariables([body.subject, html, text], input.fieldKeys, issues.add);
    const bytes = utf8Bytes(html);
    if (bytes > GMAIL_CLIP_BYTES) {
      issues.add({
        code: 'HTML_TOO_LARGE',
        severity: 'warning',
        detail: String(Math.ceil(bytes / 1024)),
      });
    }
    return { subject: body.subject, html, text, issues: issues.list() };
  }

  async personalize(
    prepared: PreparedEmail,
    variables: RecipientVariables,
  ): Promise<RenderedEmail> {
    let rendered: [string, string, string];
    try {
      rendered = await Promise.all([
        this.liquid.render(prepared.subject, variables, 'text'),
        this.liquid.render(prepared.html, variables, 'html'),
        this.liquid.render(prepared.text, variables, 'text'),
      ]);
    } catch (error) {
      throw new DomainError('VALIDATION', 'La plantilla no se pudo personalizar', {
        reason: 'TEMPLATE_RENDER',
        message: error instanceof Error ? error.message.split('\n')[0]?.slice(0, 200) : undefined,
      });
    }
    const [subject, html, text] = rendered;
    // Una sola línea: los saltos en el asunto permitirían inyectar cabeceras.
    const cleanSubject = subject
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return { subject: cleanSubject, html, text, sizeBytes: utf8Bytes(html) };
  }

  private renderContent(
    input: PrepareEmailInput,
    protector: LiquidProtector,
    report: (issue: TemplateIssue) => void,
  ): RenderedPart {
    const { body } = input;
    switch (body.format) {
      case 'BLOCKS':
        if (body.content.blocks.length === 0)
          report({ code: 'EMPTY_CONTENT', severity: 'warning' });
        return renderBlocks(body.content.blocks, {
          locale: body.locale,
          branding: input.sender.branding,
          documents: input.documents,
          protector,
          markdown: this.markdown,
          report,
        });
      case 'MARKDOWN': {
        if (body.content.markdown.trim() === '')
          report({ code: 'EMPTY_CONTENT', severity: 'warning' });
        const { html, findings } = this.markdown.render(
          protector.protect(body.content.markdown),
          protector,
        );
        if (findings.imagesWithoutAlt > 0)
          report({ code: 'IMAGE_MISSING_ALT', severity: 'warning' });
        if (findings.insecureLinks > 0) report({ code: 'INSECURE_LINK', severity: 'warning' });
        return { html, text: body.content.markdown };
      }
      case 'HTML': {
        if (body.content.html.trim() === '') report({ code: 'EMPTY_CONTENT', severity: 'warning' });
        const result = sanitizeEmailHtml(protector.protect(body.content.html), protector);
        if (result.removedUnsafeContent) report({ code: 'CONTENT_SANITIZED', severity: 'warning' });
        if (result.imagesWithoutAlt > 0) report({ code: 'IMAGE_MISSING_ALT', severity: 'error' });
        if (result.insecureLinks > 0) report({ code: 'INSECURE_LINK', severity: 'warning' });
        return {
          html: result.html,
          text: decodeEntities(htmlToPlainText(protector.restore(result.html))),
        };
      }
    }
  }

  private renderFooter(
    input: PrepareEmailInput,
    protector: LiquidProtector,
    report: (issue: TemplateIssue) => void,
  ): RenderedPart {
    const { sender, body } = input;
    const strings = EMAIL_STRINGS[body.locale];
    const custom = sender.branding.footerMd
      ? this.markdown.render(protector.protect(sender.branding.footerMd), protector).html
      : '';
    if (!sender.postalAddress) report({ code: 'POSTAL_ADDRESS_MISSING', severity: 'error' });
    const address = sender.postalAddress ? `<p>${escapeHtml(sender.postalAddress)}</p>` : '';
    const links = `<p><a href="{{ unsubscribe_url }}">${escapeHtml(strings.unsubscribe)}</a> · <a href="{{ preferences_url }}">${escapeHtml(strings.preferences)}</a></p>`;
    return {
      html: `${custom}<p>${escapeHtml(strings.reason(sender.tenantName))}</p>${address}${protector.protect(links)}`,
      text: [
        '--',
        sender.branding.footerMd,
        strings.reason(sender.tenantName),
        sender.postalAddress,
        `${strings.unsubscribe}: {{ unsubscribe_url }}`,
        `${strings.preferences}: {{ preferences_url }}`,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n'),
    };
  }

  private checkMessage(input: PrepareEmailInput, report: (issue: TemplateIssue) => void) {
    if (input.body.subject.length > SUBJECT_RECOMMENDED_MAX) {
      report({
        code: 'SUBJECT_TOO_LONG',
        severity: 'warning',
        detail: String(input.body.subject.length),
      });
    }
    if (!input.body.preheader) report({ code: 'PREHEADER_MISSING', severity: 'warning' });
  }

  private checkVariables(
    sources: readonly string[],
    fieldKeys: ReadonlySet<string>,
    report: (issue: TemplateIssue) => void,
  ) {
    for (const source of sources) {
      const analysis = this.liquid.analyze(source);
      if (!analysis.ok) {
        report({
          code: 'LIQUID_SYNTAX',
          severity: 'error',
          detail: analysis.message.slice(0, 200),
        });
        return;
      }
      for (const variable of analysis.variables) {
        if (!isKnownVariable(variable, fieldKeys)) {
          report({ code: 'UNKNOWN_VARIABLE', severity: 'warning', detail: variable });
        }
      }
    }
  }
}
