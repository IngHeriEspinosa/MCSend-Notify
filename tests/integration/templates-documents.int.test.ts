/**
 * Plantillas y documentos contra PostgreSQL real: versiones con concurrencia optimista,
 * inmutabilidad del historial y aislamiento entre tenants (IDOR).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { TemplateBody } from '@/core/templates/email-content';
import { PrismaDocumentRepository } from '@/infrastructure/persistence/prisma/repositories/document.prisma-repository';
import { PrismaTemplateRepository } from '@/infrastructure/persistence/prisma/repositories/template.prisma-repository';
import { PrismaTenantRepository } from '@/infrastructure/persistence/prisma/repositories/tenant.prisma-repository';
import { createTestPrisma, createTestTenant } from './helpers';

const { prisma, clients } = createTestPrisma();
const templates = new PrismaTemplateRepository(prisma, clients);
const documents = new PrismaDocumentRepository(clients);
const tenants = new PrismaTenantRepository(prisma, clients);

let tenantA: TenantContext;
let tenantB: TenantContext;
let userA: string;

const body = (subject: string): TemplateBody => ({
  format: 'BLOCKS',
  subject,
  preheader: 'Preencabezado',
  locale: 'es',
  content: {
    blocks: [
      { id: 'h1', type: 'heading', text: 'Hola {{ contact.first_name }}', level: 1, align: 'left' },
    ],
  },
});

beforeAll(async () => {
  tenantA = await createTestTenant(prisma, 'tpl-a');
  tenantB = await createTestTenant(prisma, 'tpl-b');
  userA = tenantA.actor.type === 'user' ? tenantA.actor.userId : '';
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaTemplateRepository', () => {
  it('crea la versión 1 y cada guardado añade una versión con concurrencia optimista', async () => {
    const created = await templates.create(tenantA, {
      name: 'Resumen semanal',
      description: null,
      body: body('v1'),
      note: null,
      userId: userA,
    });
    expect(created.currentVersion).toBe(1);
    expect(created.body).toEqual(body('v1'));

    const saved = await templates.saveVersion(tenantA, created.id, 1, {
      name: 'Resumen semanal',
      description: 'Cada lunes',
      body: body('v2'),
      note: 'nuevo asunto',
      userId: userA,
    });
    expect(saved?.currentVersion).toBe(2);
    expect(saved?.subject).toBe('v2');

    const stale = await templates.saveVersion(tenantA, created.id, 1, {
      name: 'Resumen semanal',
      description: null,
      body: body('conflicto'),
      note: null,
      userId: userA,
    });
    expect(stale).toBeNull();

    const versions = await templates.listVersions(tenantA, created.id);
    expect(versions.map((item) => [item.version, item.note])).toEqual([
      [2, 'nuevo asunto'],
      [1, null],
    ]);
    expect(versions[0]?.createdByName).toBe(`${tenantA.tenantSlug}@example.com`);
    expect((await templates.findVersion(tenantA, created.id, 1))?.body.subject).toBe('v1');
  });

  it('el nombre es único por tenant (CONFLICT) pero se puede repetir en otro tenant', async () => {
    const input = {
      name: 'Duplicada',
      description: null,
      body: body('x'),
      note: null,
      userId: userA,
    };
    await templates.create(tenantA, input);
    await expect(templates.create(tenantA, input)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(templates.create(tenantB, input)).resolves.toMatchObject({ name: 'Duplicada' });
  });

  it('el historial es inmutable en la base de datos', async () => {
    const created = await templates.create(tenantA, {
      name: 'Inmutable',
      description: null,
      body: body('x'),
      note: null,
      userId: userA,
    });
    await expect(
      prisma.$executeRaw`UPDATE template_versions SET subject = 'alterado' WHERE template_id = ${created.id}::uuid`,
    ).rejects.toThrow(/inmutable/);
  });

  it('otro tenant no lee, guarda, lista versiones ni borra la plantilla', async () => {
    const created = await templates.create(tenantA, {
      name: 'Privada',
      description: null,
      body: body('x'),
      note: null,
      userId: userA,
    });
    expect(await templates.findById(tenantB, created.id)).toBeNull();
    expect(await templates.listVersions(tenantB, created.id)).toEqual([]);
    expect(
      await templates.saveVersion(tenantB, created.id, 1, {
        name: 'Robada',
        description: null,
        body: body('x'),
        note: null,
        userId: userA,
      }),
    ).toBeNull();
    expect(await templates.delete(tenantB, created.id)).toBe(false);
    expect((await templates.list(tenantB)).map((item) => item.id)).not.toContain(created.id);
    expect(await templates.findById(tenantA, created.id)).not.toBeNull();
  });
});

describe('PrismaDocumentRepository', () => {
  it('transiciones atómicas y aislamiento entre tenants', async () => {
    const id = crypto.randomUUID();
    await documents.create(tenantA, {
      id,
      title: 'Deck',
      fileName: 'deck.pptx',
      extension: 'pptx',
      kind: 'PRESENTATION',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: 1000,
      sha256: 'a'.repeat(64),
      storageKey: `tenants/${tenantA.tenantId}/documents/${id}/original.pptx`,
      createdById: userA,
    });

    expect(await documents.transition(tenantA, id, ['FAILED'], { status: 'UPLOADED' })).toBe(false);
    expect(await documents.transition(tenantA, id, ['UPLOADED'], { status: 'PROCESSING' })).toBe(
      true,
    );
    expect(await documents.transition(tenantB, id, ['PROCESSING'], { status: 'READY' })).toBe(
      false,
    );

    expect(await documents.findById(tenantB, id)).toBeNull();
    expect(await documents.findManyByIds(tenantB, [id])).toEqual([]);
    expect(await documents.list(tenantB, {})).toEqual([]);
    expect(await documents.delete(tenantB, id)).toBe(false);

    const found = await documents.list(tenantA, { search: 'DECK', kind: 'PRESENTATION' });
    expect(found.map((item) => item.id)).toEqual([id]);
    expect(await documents.delete(tenantA, id)).toBe(true);
  });
});

describe('Branding del tenant', () => {
  it('guarda y lee el branding validado junto con el perfil del remitente', async () => {
    const before = await tenants.getEmailProfile(tenantA);
    expect(before.branding.primary).toBe('#005E7D');

    await tenants.saveBranding(tenantA, {
      primary: '#004A63',
      accent: '#EBAD39',
      logoKey: null,
      footerMd: 'Pie *propio*',
    });
    const after = await tenants.getEmailProfile(tenantA);
    expect(after.branding).toEqual({
      primary: '#004A63',
      accent: '#EBAD39',
      logoKey: null,
      footerMd: 'Pie *propio*',
    });
    expect((await tenants.getEmailProfile(tenantB)).branding.primary).toBe('#005E7D');
  });
});
