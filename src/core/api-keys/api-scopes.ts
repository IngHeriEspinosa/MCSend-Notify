/** Permisos que se pueden conceder a una clave de API (integraciones de las aplicaciones). */
export const API_SCOPES = ['contacts:read', 'contacts:write'] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && (API_SCOPES as readonly string[]).includes(value);
}
