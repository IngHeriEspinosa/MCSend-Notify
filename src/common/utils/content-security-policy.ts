/**
 * Construye la Content-Security-Policy con nonce por petición (OWASP A03/A05).
 *
 * - Scripts: solo los que llevan el nonce (Next.js lo aplica a los suyos) y los que estos
 *   cargan ('strict-dynamic'). En desarrollo se permite 'unsafe-eval' para el HMR.
 * - Estilos: 'unsafe-inline' porque MUI/Emotion y React usan atributos `style`; el riesgo de
 *   inyección de estilos es bajo y queda documentado en docs/TECHNICAL.md.
 * - Imágenes: además de las propias, cualquier origen https. La vista previa de correos
 *   (iframe `srcdoc`, que hereda esta política) muestra imágenes externas de las plantillas.
 *   Una imagen no ejecuta código; los scripts siguen limitados por nonce.
 */
export interface ContentSecurityPolicyOptions {
  nonce: string;
  isDevelopment: boolean;
}

export function buildContentSecurityPolicy({
  nonce,
  isDevelopment,
}: ContentSecurityPolicyOptions): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (isDevelopment) {
    scriptSrc.push("'unsafe-eval'");
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'frame-src': ["'self'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
  };

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (!isDevelopment) {
    policy.push('upgrade-insecure-requests');
  }
  return policy.join('; ');
}

/** Nonce criptográficamente aleatorio en base64 (16 bytes). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
