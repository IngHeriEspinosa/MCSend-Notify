/**
 * Estructura HTML común de los correos (compatible con Outlook, Gmail y Apple Mail):
 * tablas de 600 px, preencabezado oculto, cabecera con logotipo, contenido y pie obligatorio
 * con dirección postal y enlaces de baja y preferencias (CAN-SPAM, RFC 8058 en Fase 3).
 *
 * Los estilos se escriben en <style> y juice los aplica en línea; solo se conservan en <style>
 * las media queries (móvil y modo oscuro), que los clientes compatibles aplican con !important.
 */
import { buttonTextColor, type TenantBranding } from '@/core/tenants/branding';
import { escapeHtml } from './html';

export const CONTENT_WIDTH = 536;
const FONT_STACK = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

export const EMAIL_COLORS = {
  page: '#F4F6F8',
  card: '#FFFFFF',
  text: '#1F2328',
  muted: '#5F6368',
  border: '#DADCE0',
  darkPage: '#121212',
  darkCard: '#1E1E1E',
  darkText: '#E8EAED',
  darkMuted: '#B4B8BE',
  darkBorder: '#3C4043',
  darkLink: '#8FD0EC',
} as const;

function baseCss(branding: TenantBranding): string {
  const c = EMAIL_COLORS;
  return `
body { margin: 0; padding: 0; background-color: ${c.page}; }
table { border-collapse: collapse; }
img { border: 0; outline: none; text-decoration: none; }
.mc-content { font-family: ${FONT_STACK}; color: ${c.text}; font-size: 16px; line-height: 1.6; }
.mc-content p { margin: 0 0 16px 0; }
.mc-content h1 { font-size: 26px; line-height: 1.3; margin: 8px 0 16px 0; color: ${c.text}; }
.mc-content h2 { font-size: 20px; line-height: 1.35; margin: 8px 0 12px 0; color: ${c.text}; }
.mc-content h3 { font-size: 17px; margin: 8px 0 8px 0; color: ${c.text}; }
.mc-content a { color: ${branding.primary}; text-decoration: underline; }
.mc-content ul, .mc-content ol { margin: 0 0 16px 0; padding-left: 24px; }
.mc-content li { margin: 0 0 6px 0; }
.mc-content blockquote { margin: 0 0 16px 0; padding: 8px 16px; border-left: 4px solid ${branding.accent}; color: ${c.muted}; }
.mc-content code { font-family: Consolas, 'Courier New', monospace; font-size: 14px; background-color: ${c.page}; padding: 1px 4px; }
.mc-content pre { font-family: Consolas, 'Courier New', monospace; font-size: 13px; background-color: ${c.page}; padding: 12px; white-space: pre-wrap; }
.mc-content hr { border: 0; border-top: 1px solid ${c.border}; margin: 24px 0; }
.mc-content table { width: 100%; }
.mc-header { font-family: ${FONT_STACK}; color: ${branding.primary}; font-size: 20px; font-weight: bold; }
.mc-footer { font-family: ${FONT_STACK}; color: ${c.muted}; font-size: 12px; line-height: 1.5; }
.mc-footer p { margin: 0 0 8px 0; }
.mc-footer a { color: ${c.muted}; text-decoration: underline; }
.mc-content .mc-doc-meta { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: ${c.muted}; margin: 0 0 4px 0; }
.mc-content .mc-doc-title { font-size: 18px; font-weight: bold; margin: 0 0 8px 0; }
.mc-content .mc-btn a { color: ${buttonTextColor(branding.accent)}; text-decoration: none; }`;
}

const RESPONSIVE_CSS = `
@media only screen and (max-width: 620px) {
  .mc-container { width: 100% !important; }
  .mc-pad { padding-left: 20px !important; padding-right: 20px !important; }
  .mc-col { display: block !important; width: 100% !important; padding: 0 !important; }
}`;

function darkRules(branding: TenantBranding): string {
  const c = EMAIL_COLORS;
  return `
  .mc-page, body { background-color: ${c.darkPage} !important; }
  .mc-card { background-color: ${c.darkCard} !important; }
  .mc-content, .mc-content h1, .mc-content h2, .mc-content h3, .mc-doc-title { color: ${c.darkText} !important; }
  .mc-content a { color: ${c.darkLink} !important; }
  .mc-content .mc-btn a { color: ${buttonTextColor(branding.accent)} !important; }
  .mc-footer, .mc-footer a, .mc-doc-meta, .mc-content blockquote { color: ${c.darkMuted} !important; }
  .mc-doc { border-color: ${c.darkBorder} !important; }
  .mc-header { color: ${c.darkText} !important; }`;
}

export interface LayoutInput {
  locale: 'es' | 'en';
  /** Asunto (con marcadores Liquid protegidos) para <title>. */
  title: string;
  preheader: string | null;
  contentHtml: string;
  footerHtml: string;
  branding: TenantBranding;
  tenantName: string;
  logoUrl: string | null;
  forceColorScheme?: 'light' | 'dark' | undefined;
}

/** Documento completo (antes de juice). Todo texto variable llega ya escapado o saneado. */
export function buildEmailDocument(input: LayoutInput): string {
  const darkCss =
    input.forceColorScheme === 'dark'
      ? darkRules(input.branding)
      : input.forceColorScheme === 'light'
        ? ''
        : `\n@media (prefers-color-scheme: dark) {${darkRules(input.branding)}\n}`;
  const header = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" alt="${escapeHtml(input.tenantName)}" height="48" style="display: block; height: 48px; width: auto; max-width: 240px;">`
    : escapeHtml(input.tenantName);
  // Relleno invisible tras el preencabezado para que el cliente no muestre el inicio del cuerpo.
  const preheader = input.preheader
    ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0; mso-hide: all;">${input.preheader}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
    : '';

  return `<!doctype html>
<html lang="${input.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${input.title}</title>
<style>${baseCss(input.branding)}${RESPONSIVE_CSS}${darkCss}
</style>
</head>
<body class="mc-page">
${preheader}
<table role="presentation" class="mc-page" width="100%" cellpadding="0" cellspacing="0" style="background-color: ${EMAIL_COLORS.page};">
<tr><td align="center" style="padding: 24px 12px;">
<table role="presentation" class="mc-container" width="600" cellpadding="0" cellspacing="0" style="width: 600px; max-width: 600px;">
<tr><td class="mc-card mc-header mc-pad" style="background-color: ${EMAIL_COLORS.card}; border-top: 4px solid ${input.branding.primary}; padding: 24px 32px 8px 32px;">${header}</td></tr>
<tr><td class="mc-card mc-content mc-pad" style="background-color: ${EMAIL_COLORS.card}; padding: 16px 32px 32px 32px;">
${input.contentHtml}
</td></tr>
<tr><td class="mc-footer mc-pad" style="padding: 24px 32px;">
${input.footerHtml}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
