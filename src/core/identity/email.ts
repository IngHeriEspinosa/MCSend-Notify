/** Normalización de emails: clave de deduplicación de usuarios, invitaciones y contactos. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string): string {
  return normalizeEmail(email).split('@').pop() ?? '';
}
