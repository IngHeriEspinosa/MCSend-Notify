/**
 * Identidad visual de un tenant aplicada a sus correos: colores, logotipo y texto del pie.
 *
 * Reglas de accesibilidad (WCAG AA) que se validan al guardar:
 * - El color primario se usa como texto de enlaces y titulares sobre blanco: contraste ≥ 4,5:1.
 * - El color de acento es el fondo de los botones: su texto (blanco u oscuro, el que más contraste
 *   ofrezca) debe alcanzar 4,5:1.
 */
import { z } from 'zod';
import { contrastRatio, WCAG_AA_NORMAL_TEXT } from '@/common/utils/color-contrast';
import type { TenantContext } from '@/core/shared/tenant-context';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const BUTTON_TEXT_LIGHT = '#FFFFFF';
export const BUTTON_TEXT_DARK = '#1A1A1A';
const EMAIL_BACKGROUND = '#FFFFFF';

export const DEFAULT_BRANDING = {
  primary: '#005E7D',
  accent: '#005E7D',
  logoKey: null,
  footerMd: null,
} as const satisfies TenantBranding;

export interface TenantBranding {
  primary: string;
  accent: string;
  /** Clave del logotipo en el almacenamiento de objetos (PNG normalizado por el sistema). */
  logoKey: string | null;
  /** Texto libre del pie en Markdown (sin HTML). */
  footerMd: string | null;
}

/** Color de texto con más contraste sobre el fondo del botón. */
export function buttonTextColor(accent: string): string {
  return contrastRatio(BUTTON_TEXT_LIGHT, accent) >= contrastRatio(BUTTON_TEXT_DARK, accent)
    ? BUTTON_TEXT_LIGHT
    : BUTTON_TEXT_DARK;
}

export function brandingContrast(branding: Pick<TenantBranding, 'primary' | 'accent'>) {
  const primary = contrastRatio(branding.primary, EMAIL_BACKGROUND);
  const button = contrastRatio(buttonTextColor(branding.accent), branding.accent);
  return {
    primary,
    button,
    primaryOk: primary >= WCAG_AA_NORMAL_TEXT,
    buttonOk: button >= WCAG_AA_NORMAL_TEXT,
  };
}

const colorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR)
  .transform((value) => value.toUpperCase());

/** Datos editables desde la configuración (el logotipo se sube por separado). */
export const updateBrandingSchema = z
  .object({
    primary: colorSchema,
    accent: colorSchema,
    footerMd: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value === '' ? null : value))
      .nullable(),
  })
  .superRefine((value, ctx) => {
    const contrast = brandingContrast(value);
    if (!contrast.primaryOk) {
      ctx.addIssue({ code: 'custom', path: ['primary'], message: 'LOW_CONTRAST' });
    }
    if (!contrast.buttonOk) {
      ctx.addIssue({ code: 'custom', path: ['accent'], message: 'LOW_CONTRAST' });
    }
  });

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>;

/** Lectura tolerante del JSON persistido: valores ausentes o inválidos toman el predeterminado. */
export function parseBranding(value: unknown): TenantBranding {
  const source = typeof value === 'object' && value !== null ? value : {};
  const read = (key: string): unknown => (source as Record<string, unknown>)[key];
  const color = (key: 'primary' | 'accent') => {
    const raw = read(key);
    return typeof raw === 'string' && HEX_COLOR.test(raw)
      ? raw.toUpperCase()
      : DEFAULT_BRANDING[key];
  };
  const text = (key: 'logoKey' | 'footerMd') => {
    const raw = read(key);
    return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
  };
  return {
    primary: color('primary'),
    accent: color('accent'),
    logoKey: text('logoKey'),
    footerMd: text('footerMd'),
  };
}

/** Datos del remitente que aparecen en todos los correos del tenant. */
export interface TenantEmailProfile {
  name: string;
  postalAddress: string | null;
  defaultLocale: string;
  branding: TenantBranding;
}

export interface BrandingRepository {
  getEmailProfile(context: TenantContext): Promise<TenantEmailProfile>;
  saveBranding(context: TenantContext, branding: TenantBranding): Promise<void>;
}
