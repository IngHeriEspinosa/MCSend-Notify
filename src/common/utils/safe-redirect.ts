/** Solo rutas internas relativas: evita redirecciones abiertas (OWASP A01). */
export function safeRedirectPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\') || /[\r\n]/.test(value)) return fallback;
  return value;
}
