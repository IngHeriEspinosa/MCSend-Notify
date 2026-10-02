import { describe, expect, it } from 'vitest';
import { InvalidEnvironmentError, parseServerEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5452/mcsn',
  REDIS_URL: 'redis://localhost:6390',
  GOTENBERG_URL: 'http://localhost:3100',
};

describe('parseServerEnv', () => {
  it('aplica valores por defecto a las variables opcionales', () => {
    const env = parseServerEnv(validEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_URL).toBe('http://localhost:3020');
    expect(env.WORKER_HEALTH_PORT).toBe(9464);
    expect(env.MCLOG_URL).toBeUndefined();
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
