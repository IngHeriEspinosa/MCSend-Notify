/** Traducción de errores de Prisma a errores de dominio. */
import { DomainError } from '@/core/shared/domain-error';
import { Prisma } from './generated/client';

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/** Ejecuta la operación y convierte violaciones de unicidad en CONFLICT y "no encontrado" en NOT_FOUND. */
export async function withDomainErrors<T>(
  operation: () => Promise<T>,
  conflictField: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError('CONFLICT', `Valor duplicado en ${conflictField}`, {
        field: conflictField,
      });
    }
    if (isRecordNotFound(error)) {
      throw new DomainError('NOT_FOUND', 'Registro inexistente');
    }
    throw error;
  }
}
