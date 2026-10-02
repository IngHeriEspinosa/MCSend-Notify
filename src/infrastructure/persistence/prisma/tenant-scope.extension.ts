/**
 * Aislamiento multi-tenant en la capa de datos (defensa en profundidad contra IDOR, OWASP A01).
 *
 * `scopeToTenant(prisma, tenantId)` devuelve un cliente que, en los modelos con tenant:
 * - añade `tenantId` al `where` de toda lectura, actualización y borrado;
 * - fija `tenantId` en toda creación (y rechaza otro valor);
 * - impide mover filas a otro tenant y las escrituras anidadas en relaciones.
 * Las consultas SQL en bruto no pasan por aquí: los repositorios que las usan filtran
 * explícitamente por `tenant_id`.
 */
import type { PrismaClient } from './generated/client';
import { isTenantModel, TENANT_MODEL_RELATIONS, type TenantModelName } from './tenant-models';

export class TenantScopeViolationError extends Error {
  constructor(model: string, operation: string, reason: string) {
    super(`Violación del aislamiento de tenant en ${model}.${operation}: ${reason}`);
    this.name = 'TenantScopeViolationError';
  }
}

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

type Args = Record<string, unknown>;

function isRecord(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scopeWhere(model: string, operation: string, where: unknown, tenantId: string): Args {
  const base = isRecord(where) ? where : {};
  if (base.tenantId !== undefined && base.tenantId !== tenantId) {
    throw new TenantScopeViolationError(model, operation, 'filtro de tenantId distinto');
  }
  return { ...base, tenantId };
}

function scopeData(
  model: TenantModelName,
  operation: string,
  data: unknown,
  tenantId: string,
  mode: 'create' | 'update',
): Args {
  if (!isRecord(data)) {
    throw new TenantScopeViolationError(model, operation, 'datos inválidos');
  }
  const relations: readonly string[] = TENANT_MODEL_RELATIONS[model];
  const nested = Object.keys(data).find((key) => relations.includes(key));
  if (nested) {
    throw new TenantScopeViolationError(model, operation, `escritura anidada en "${nested}"`);
  }
  if (data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new TenantScopeViolationError(model, operation, 'tenantId distinto en los datos');
  }
  return mode === 'create' ? { ...data, tenantId } : data;
}

/** Transforma los argumentos de una operación para restringirla al tenant. Función pura. */
export function scopeArgs<T>(model: string, operation: string, args: T, tenantId: string): T {
  if (!isTenantModel(model)) return args;
  const input: Args = isRecord(args) ? { ...args } : {};

  if (WHERE_OPERATIONS.has(operation)) {
    input.where = scopeWhere(model, operation, input.where, tenantId);
    if (input.data !== undefined) {
      input.data = scopeData(model, operation, input.data, tenantId, 'update');
    }
  } else if (CREATE_OPERATIONS.has(operation)) {
    input.data = Array.isArray(input.data)
      ? input.data.map((row) => scopeData(model, operation, row, tenantId, 'create'))
      : scopeData(model, operation, input.data, tenantId, 'create');
  } else if (operation === 'upsert') {
    input.where = scopeWhere(model, operation, input.where, tenantId);
    input.create = scopeData(model, operation, input.create, tenantId, 'create');
    input.update = scopeData(model, operation, input.update, tenantId, 'update');
  } else {
    throw new TenantScopeViolationError(model, operation, 'operación no soportada');
  }
  return input as T;
}

export function scopeToTenant(prisma: PrismaClient, tenantId: string) {
  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args, tenantId));
        },
      },
    },
  });
}

export type TenantScopedPrisma = ReturnType<typeof scopeToTenant>;

const MAX_CACHED_CLIENTS = 200;

/** Reutiliza el cliente extendido por tenant (crear extensiones en cada consulta es innecesario). */
export class TenantClientCache {
  private readonly clients = new Map<string, TenantScopedPrisma>();

  constructor(private readonly prisma: PrismaClient) {}

  forTenant(tenantId: string): TenantScopedPrisma {
    const cached = this.clients.get(tenantId);
    if (cached) {
      this.clients.delete(tenantId);
      this.clients.set(tenantId, cached);
      return cached;
    }
    const client = scopeToTenant(this.prisma, tenantId);
    this.clients.set(tenantId, client);
    if (this.clients.size > MAX_CACHED_CLIENTS) {
      const oldest = this.clients.keys().next().value;
      if (oldest !== undefined) this.clients.delete(oldest);
    }
    return client;
  }
}
