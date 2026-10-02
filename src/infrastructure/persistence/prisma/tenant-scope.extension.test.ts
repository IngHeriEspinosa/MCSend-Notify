import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scopeArgs, TenantScopeViolationError } from './tenant-scope.extension';
import { TENANT_MODEL_RELATIONS } from './tenant-models';

const TENANT = 'tenant-a';

describe('scopeArgs', () => {
  it('añade tenantId al where de lecturas, actualizaciones y borrados', () => {
    expect(scopeArgs('Contact', 'findMany', { where: { status: 'ACTIVE' } }, TENANT)).toEqual({
      where: { status: 'ACTIVE', tenantId: TENANT },
    });
    expect(scopeArgs('Contact', 'findUnique', { where: { id: 'c1' } }, TENANT)).toEqual({
      where: { id: 'c1', tenantId: TENANT },
    });
    expect(scopeArgs('ContactList', 'deleteMany', {}, TENANT)).toEqual({
      where: { tenantId: TENANT },
    });
  });

  it('fija tenantId en las creaciones, también en lote', () => {
    expect(scopeArgs('Tag', 'create', { data: { name: 'VIP' } }, TENANT)).toEqual({
      data: { name: 'VIP', tenantId: TENANT },
    });
    expect(
      scopeArgs(
        'ListMembership',
        'createMany',
        { data: [{ listId: 'l', contactId: 'c' }] },
        TENANT,
      ),
    ).toEqual({ data: [{ listId: 'l', contactId: 'c', tenantId: TENANT }] });
  });

  it('rechaza consultar o escribir en otro tenant', () => {
    expect(() => scopeArgs('Contact', 'findMany', { where: { tenantId: 'otro' } }, TENANT)).toThrow(
      TenantScopeViolationError,
    );
    expect(() => scopeArgs('Contact', 'create', { data: { tenantId: 'otro' } }, TENANT)).toThrow(
      TenantScopeViolationError,
    );
    expect(() =>
      scopeArgs('Contact', 'update', { where: { id: 'c1' }, data: { tenantId: 'otro' } }, TENANT),
    ).toThrow(TenantScopeViolationError);
  });

  it('rechaza escrituras anidadas en relaciones', () => {
    expect(() =>
      scopeArgs(
        'Contact',
        'create',
        { data: { email: 'a@b.com', listMemberships: { create: [{ listId: 'l' }] } } },
        TENANT,
      ),
    ).toThrow(/anidada/);
  });

  it('no altera los modelos globales', () => {
    const args = { where: { email: 'a@b.com' } };
    expect(scopeArgs('User', 'findUnique', args, TENANT)).toBe(args);
  });

  it('acota upsert en where, create y update', () => {
    expect(
      scopeArgs(
        'Topic',
        'upsert',
        { where: { id: 't1' }, create: { key: 'k' }, update: { isDefault: false } },
        TENANT,
      ),
    ).toEqual({
      where: { id: 't1', tenantId: TENANT },
      create: { key: 'k', tenantId: TENANT },
      update: { isDefault: false },
    });
  });
});

/**
 * Guardia del esquema: toda tabla con tenantId debe estar registrada en TENANT_MODEL_RELATIONS,
 * con todos sus campos de relación (para bloquear escrituras anidadas).
 */
describe('registro de modelos con tenant', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((match) => ({
    name: match[1] ?? '',
    body: match[2] ?? '',
  }));
  const modelNames = new Set(models.map((model) => model.name));

  it('coincide con los modelos que tienen columna tenantId', () => {
    const withTenantId = models
      .filter((model) => /^\s+tenantId\s/m.test(model.body))
      .map((model) => model.name);
    expect(withTenantId.sort()).toEqual(Object.keys(TENANT_MODEL_RELATIONS).sort());
  });

  it('declara todos los campos de relación de cada modelo', () => {
    for (const model of models.filter((candidate) => candidate.name in TENANT_MODEL_RELATIONS)) {
      const relationFields = [...model.body.matchAll(/^\s+(\w+)\s+(\w+)(\[\])?\??\s/gm)]
        .filter((field) => modelNames.has(field[2] ?? ''))
        .map((field) => field[1]);
      const declared = TENANT_MODEL_RELATIONS[model.name as keyof typeof TENANT_MODEL_RELATIONS];
      expect([...relationFields].sort(), model.name).toEqual([...declared].sort());
    }
  });
});
