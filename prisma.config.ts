/**
 * Configuración de Prisma 7. La URL de la base de datos se lee del entorno;
 * en desarrollo se carga `.env` si existe (en Docker llegan como variables del contenedor).
 * Autor: Ing. Heri Espinosa
 */
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
