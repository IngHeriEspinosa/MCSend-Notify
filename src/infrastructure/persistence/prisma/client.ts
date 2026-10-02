/**
 * Fábrica del cliente Prisma 7 con el driver adapter de PostgreSQL (`pg`).
 * La instancia compartida se obtiene desde `src/infrastructure/container.ts`.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export type { PrismaClient };

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
