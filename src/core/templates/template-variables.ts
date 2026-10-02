/**
 * Variables disponibles en las plantillas (sintaxis Liquid) y construcción de sus valores
 * para un destinatario. Los nombres usan snake_case, la convención habitual de Liquid.
 */

export const CONTACT_VARIABLES = [
  'contact.first_name',
  'contact.last_name',
  'contact.full_name',
  'contact.email',
  'contact.company',
] as const;

export const SYSTEM_VARIABLES = [
  'tenant.name',
  'unsubscribe_url',
  'preferences_url',
  'current_year',
] as const;

/** Prefijo de los campos personalizados: `{{ fields.plan }}`. */
export const CUSTOM_FIELD_PREFIX = 'fields.';

export interface RecipientData {
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  attributes: Record<string, unknown>;
}

export interface RecipientLinks {
  unsubscribeUrl: string;
  preferencesUrl: string;
}

export interface RecipientVariables {
  contact: {
    first_name: string;
    last_name: string;
    full_name: string;
    email: string;
    company: string;
  };
  fields: Record<string, string | number | boolean>;
  tenant: { name: string };
  unsubscribe_url: string;
  preferences_url: string;
  current_year: number;
  /** Seguimiento de la entrega (solo en envíos reales): píxel y enlaces sustituidos. */
  tracking?: { open_url: string; links: Record<string, string> } | undefined;
}

/** Contacto ficticio para la vista previa cuando no se elige uno real. */
export const SAMPLE_RECIPIENT: RecipientData = {
  email: 'ana.perez@example.com',
  firstName: 'Ana',
  lastName: 'Pérez',
  company: 'Empresa de ejemplo',
  attributes: {},
};

function scalar(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

export function buildRecipientVariables(input: {
  recipient: RecipientData;
  tenantName: string;
  links: RecipientLinks;
  now: Date;
}): RecipientVariables {
  const { recipient } = input;
  const fields: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(recipient.attributes)) {
    const safe = scalar(value);
    if (safe !== null) fields[key] = safe;
  }
  const firstName = recipient.firstName ?? '';
  const lastName = recipient.lastName ?? '';
  return {
    contact: {
      first_name: firstName,
      last_name: lastName,
      full_name: [firstName, lastName].filter(Boolean).join(' '),
      email: recipient.email,
      company: recipient.company ?? '',
    },
    fields,
    tenant: { name: input.tenantName },
    unsubscribe_url: input.links.unsubscribeUrl,
    preferences_url: input.links.preferencesUrl,
    current_year: input.now.getUTCFullYear(),
  };
}

/** Indica si una ruta de variable (p. ej. `fields.plan`) existe para el tenant. */
export function isKnownVariable(path: string, fieldKeys: ReadonlySet<string>): boolean {
  if ((CONTACT_VARIABLES as readonly string[]).includes(path)) return true;
  if ((SYSTEM_VARIABLES as readonly string[]).includes(path)) return true;
  if (path.startsWith(CUSTOM_FIELD_PREFIX)) {
    return fieldKeys.has(path.slice(CUSTOM_FIELD_PREFIX.length));
  }
  return false;
}
