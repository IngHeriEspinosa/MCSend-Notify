/**
 * Textos de sistema que se insertan en los correos (pie, tarjetas de documento).
 * Viven aquí y no en next-intl porque el worker también compila correos.
 */
import type { DocumentKind } from '@/core/documents/document';

export type EmailLocale = 'es' | 'en';

interface EmailStrings {
  unsubscribe: string;
  preferences: string;
  reason: (tenant: string) => string;
  kinds: Record<DocumentKind, string>;
  pages: (count: number, kind: DocumentKind) => string;
  open: (kind: DocumentKind) => string;
  thumbnailAlt: (title: string) => string;
  unavailable: string;
}

export const EMAIL_STRINGS: Record<EmailLocale, EmailStrings> = {
  es: {
    unsubscribe: 'Darse de baja',
    preferences: 'Preferencias de suscripción',
    reason: (tenant) =>
      `Recibes este correo porque estás suscrito a las comunicaciones de ${tenant}.`,
    kinds: {
      PDF: 'Documento PDF',
      PRESENTATION: 'Presentación',
      DOCUMENT: 'Documento',
      SPREADSHEET: 'Hoja de cálculo',
      IMAGE: 'Imagen',
      HTML: 'Página web',
      MARKDOWN: 'Documento',
      TEXT: 'Texto',
    },
    pages: (count, kind) =>
      kind === 'PRESENTATION'
        ? `${count} ${count === 1 ? 'diapositiva' : 'diapositivas'}`
        : `${count} ${count === 1 ? 'página' : 'páginas'}`,
    open: (kind) => (kind === 'PRESENTATION' ? 'Ver presentación' : 'Ver documento'),
    thumbnailAlt: (title) => `Vista previa de ${title}`,
    unavailable: 'Documento no disponible',
  },
  en: {
    unsubscribe: 'Unsubscribe',
    preferences: 'Email preferences',
    reason: (tenant) => `You are receiving this email because you subscribed to ${tenant} updates.`,
    kinds: {
      PDF: 'PDF document',
      PRESENTATION: 'Presentation',
      DOCUMENT: 'Document',
      SPREADSHEET: 'Spreadsheet',
      IMAGE: 'Image',
      HTML: 'Web page',
      MARKDOWN: 'Document',
      TEXT: 'Text',
    },
    pages: (count, kind) =>
      kind === 'PRESENTATION'
        ? `${count} ${count === 1 ? 'slide' : 'slides'}`
        : `${count} ${count === 1 ? 'page' : 'pages'}`,
    open: (kind) => (kind === 'PRESENTATION' ? 'View presentation' : 'View document'),
    thumbnailAlt: (title) => `Preview of ${title}`,
    unavailable: 'Document unavailable',
  },
};
