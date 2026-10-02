/**
 * Variables de entorno del servidor validadas con Zod.
 *
 * Se validan de forma perezosa en el primer acceso para que `next build` no exija secretos;
 * la app las valida al arrancar desde `instrumentation.ts` y el worker en su bootstrap, de modo
 * que una configuración inválida falla pronto y con un mensaje que nombra la variable.
 *
 * - `getServerEnv()`: variables comunes a la app y al worker.
 * - `getAuthEnv()`: variables de autenticación, solo para la app web.
 */
import { z } from 'zod';

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    APP_URL: z.url().default('http://localhost:3020'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'Debe ser una URL de PostgreSQL (postgresql://...)'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'Debe ser una URL de Redis (redis://...)'),
    GOTENBERG_URL: z.url(),
    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3).max(63),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(8),
    S3_FORCE_PATH_STYLE: z.stringbool().default(true),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9464),
    MCLOG_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    MCLOG_API_KEY: optionalString,
    MCLOG_APPLICATION: z.string().min(1).default('mc-send-notify'),
  })
  .refine((env) => (env.MCLOG_URL === undefined) === (env.MCLOG_API_KEY === undefined), {
    message: 'MCLOG_URL y MCLOG_API_KEY deben definirse juntas o dejarse ambas vacías.',
    path: ['MCLOG_API_KEY'],
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const authEnvSchema = z
  .object({
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET debe tener al menos 32 caracteres'),
    AUTH_CREDENTIALS_ENABLED: z.stringbool().default(true),
    AUTH_MICROSOFT_ENTRA_ID_ID: optionalString,
    AUTH_MICROSOFT_ENTRA_ID_SECRET: optionalString,
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: z.preprocess(emptyToUndefined, z.url().optional()),
    AUTH_ALLOWED_EMAIL_DOMAINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean),
      ),
  })
  .refine(
    (env) => {
      const entra = [
        env.AUTH_MICROSOFT_ENTRA_ID_ID,
        env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      ];
      return (
        entra.every((value) => value === undefined) || entra.every((value) => value !== undefined)
      );
    },
    {
      message:
        'Las tres variables AUTH_MICROSOFT_ENTRA_ID_* deben definirse juntas o dejarse vacías.',
      path: ['AUTH_MICROSOFT_ENTRA_ID_ID'],
    },
  )
  .refine((env) => env.AUTH_CREDENTIALS_ENABLED || env.AUTH_MICROSOFT_ENTRA_ID_ID !== undefined, {
    message: 'Debe haber al menos un método de inicio de sesión (credenciales o Entra ID).',
    path: ['AUTH_CREDENTIALS_ENABLED'],
  });

export type AuthEnv = z.infer<typeof authEnvSchema>;

export class InvalidEnvironmentError extends Error {
  constructor(details: string) {
    super(`Configuración de entorno inválida:\n${details}`);
    this.name = 'InvalidEnvironmentError';
  }
}

function parseWith<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvironmentError(z.prettifyError(result.error));
  }
  return result.data;
}

/** Valida un conjunto de variables. Función pura: se usa en tests y en `getServerEnv`. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return parseWith(serverEnvSchema, source);
}

export function parseAuthEnv(source: Record<string, string | undefined>): AuthEnv {
  return parseWith(authEnvSchema, source);
}

let cachedEnv: ServerEnv | undefined;
let cachedAuthEnv: AuthEnv | undefined;

/** Devuelve las variables validadas del proceso actual (memoizadas). */
export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}

export function getAuthEnv(): AuthEnv {
  cachedAuthEnv ??= parseAuthEnv(process.env);
  return cachedAuthEnv;
}
