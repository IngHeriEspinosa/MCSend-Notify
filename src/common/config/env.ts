/**
 * Variables de entorno del servidor validadas con Zod.
 *
 * Se validan de forma perezosa en el primer acceso (`getServerEnv`) para que `next build`
 * no exija secretos; la app las valida al arrancar desde `instrumentation.ts` y el worker
 * en su bootstrap, de modo que una configuración inválida falla pronto y con un mensaje legible.
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

export class InvalidEnvironmentError extends Error {
  constructor(details: string) {
    super(`Configuración de entorno inválida:\n${details}`);
    this.name = 'InvalidEnvironmentError';
  }
}

/** Valida un conjunto de variables. Función pura: se usa en tests y en `getServerEnv`. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvironmentError(z.prettifyError(result.error));
  }
  return result.data;
}

let cachedEnv: ServerEnv | undefined;

/** Devuelve las variables validadas del proceso actual (memoizadas). */
export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}
