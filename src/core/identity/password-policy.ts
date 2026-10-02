import { z } from 'zod';

/** Política de contraseñas (OWASP ASVS 2.1): longitud mínima 12, máxima 128, sin reglas de composición. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
