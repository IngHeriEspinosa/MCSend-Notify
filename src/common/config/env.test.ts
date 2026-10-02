import { describe, expect, it } from 'vitest';
import { InvalidEnvironmentError, parseAuthEnv, parseServerEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5452/mcsn',
  REDIS_URL: 'redis://localhost:6390',
  GOTENBERG_URL: 'http://localhost:3100',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_BUCKET: 'mc-send-notify',
  S3_ACCESS_KEY_ID: 'mcsn-app',
  S3_SECRET_ACCESS_KEY: 'secret-de-prueba',
};

describe('parseServerEnv', () => {
  it('aplica valores por defecto a las variables opcionales', () => {
    const env = parseServerEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://localhost:3020');
    expect(env.WORKER_HEALTH_PORT).toBe(9464);
    expect(env.MCLOG_URL).toBeUndefined();
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('interpreta S3_FORCE_PATH_STYLE como booleano', () => {
    expect(parseServerEnv({ ...validEnv, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(
      false,
    );
  });

  it('convierte el puerto del worker a número', () => {
    expect(parseServerEnv({ ...validEnv, WORKER_HEALTH_PORT: '9500' }).WORKER_HEALTH_PORT).toBe(
      9500,
    );
  });

  it('rechaza una URL de base de datos que no es PostgreSQL', () => {
    expect(() => parseServerEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      InvalidEnvironmentError,
    );
  });

  it('rechaza la ausencia de variables obligatorias indicando cuál falta', () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
  });

  it('trata las cadenas vacías de MCLog como no definidas', () => {
    const env = parseServerEnv({ ...validEnv, MCLOG_URL: '', MCLOG_API_KEY: '  ' });

    expect(env.MCLOG_URL).toBeUndefined();
    expect(env.MCLOG_API_KEY).toBeUndefined();
  });

  it('exige que MCLOG_URL y MCLOG_API_KEY se definan juntas', () => {
    expect(() => parseServerEnv({ ...validEnv, MCLOG_URL: 'https://mclog.example.com' })).toThrow(
      /MCLOG_API_KEY/,
    );
  });
});

describe('parseAuthEnv', () => {
  const secret = 'a'.repeat(32);

  it('separa y normaliza los dominios permitidos', () => {
    const env = parseAuthEnv({
      AUTH_SECRET: secret,
      AUTH_ALLOWED_EMAIL_DOMAINS: ' Multicomputos.com, cliente.do ,',
    });
    expect(env.AUTH_ALLOWED_EMAIL_DOMAINS).toEqual(['multicomputos.com', 'cliente.do']);
    expect(env.AUTH_CREDENTIALS_ENABLED).toBe(true);
  });

  it('exige un AUTH_SECRET robusto', () => {
    expect(() => parseAuthEnv({ AUTH_SECRET: 'corto' })).toThrow(/AUTH_SECRET/);
  });

  it('exige las tres variables de Entra ID juntas', () => {
    expect(() =>
      parseAuthEnv({ AUTH_SECRET: secret, AUTH_MICROSOFT_ENTRA_ID_ID: 'client-id' }),
    ).toThrow(/AUTH_MICROSOFT_ENTRA_ID/);
  });

  it('exige al menos un método de inicio de sesión', () => {
    expect(() => parseAuthEnv({ AUTH_SECRET: secret, AUTH_CREDENTIALS_ENABLED: 'false' })).toThrow(
      /método de inicio de sesión/,
    );
  });
});
