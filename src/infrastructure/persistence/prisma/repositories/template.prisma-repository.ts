/**
 * Repositorio de plantillas con historial de versiones.
 * Guardar = actualización condicionada a la versión vigente + inserción de la versión nueva,
 * en una transacción (concurrencia optimista sin bloqueos).
 */
import { DomainError } from '@/core/shared/domain-error';
import type { TenantContext } from '@/core/shared/tenant-context';
import { templateBodySchema, type TemplateBody } from '@/core/templates/email-content';
import type {
  TemplateRecord,
  TemplateRepository,
  TemplateSummary,
  TemplateVersionRecord,
  TemplateVersionSummary,
  TemplateWrite,
} from '@/core/templates/ports';
import type { Prisma, PrismaClient } from '../generated/client';
import { withDomainErrors } from '../prisma-errors';
import type { TenantClientCache } from '../tenant-scope.extension';

const SUMMARY_SELECT = {
  id: true,
  name: true,
  description: true,
  format: true,
  subject: true,
  locale: true,
  currentVersion: true,
  updatedAt: true,
} as const;

const RECORD_SELECT = {
  ...SUMMARY_SELECT,
  preheader: true,
  content: true,
  createdAt: true,
} as const;

interface BodyColumns {
  format: string;
  subject: string;
  preheader: string | null;
  locale: string;
  content: unknown;
}

/** El JSON persistido se valida al leer: un contenido corrupto nunca llega al compilador. */
function toBody(row: BodyColumns): TemplateBody {
  const parsed = templateBodySchema.safeParse({
    format: row.format,
    subject: row.subject,
    preheader: row.preheader,
    locale: row.locale,
    content: row.content,
  });
  if (!parsed.success) throw new DomainError('INVALID_STATE', 'Contenido de plantilla inválido');
  return parsed.data;
}

function toLocale(value: string): 'es' | 'en' {
  return value === 'en' ? 'en' : 'es';
}

function toSummary(row: {
  id: string;
  name: string;
  description: string | null;
  format: TemplateBody['format'];
  subject: string;
  locale: string;
  currentVersion: number;
  updatedAt: Date;
}): TemplateSummary {
  return { ...row, locale: toLocale(row.locale) };
}

function toRecord(
  row: Prisma.TemplateGetPayload<{ select: typeof RECORD_SELECT }>,
): TemplateRecord {
  return {
    ...toSummary(row),
    body: toBody(row),
    createdAt: row.createdAt,
  };
}

function bodyColumns(body: TemplateBody) {
  return {
    format: body.format,
    subject: body.subject,
    preheader: body.preheader,
    locale: body.locale,
    content: body.content as Prisma.InputJsonValue,
  };
}

export class PrismaTemplateRepository implements TemplateRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clients: TenantClientCache,
  ) {}

  async list(context: TenantContext): Promise<TemplateSummary[]> {
    const rows = await this.clients
      .forTenant(context.tenantId)
      .template.findMany({ select: SUMMARY_SELECT, orderBy: { updatedAt: 'desc' } });
    return rows.map(toSummary);
  }

  async findById(context: TenantContext, templateId: string): Promise<TemplateRecord | null> {
    const row = await this.clients
      .forTenant(context.tenantId)
      .template.findFirst({ where: { id: templateId }, select: RECORD_SELECT });
    return row ? toRecord(row) : null;
  }

  create(context: TenantContext, input: TemplateWrite): Promise<TemplateRecord> {
    const scoped = this.clients.forTenant(context.tenantId);
    return withDomainErrors(
      () =>
        scoped.$transaction(async (tx) => {
          const row = await tx.template.create({
            data: {
              tenantId: context.tenantId,
              name: input.name,
              description: input.description,
              ...bodyColumns(input.body),
              currentVersion: 1,
              createdById: input.userId,
              updatedById: input.userId,
            },
            select: RECORD_SELECT,
          });
          await tx.templateVersion.create({
            data: {
              tenantId: context.tenantId,
              templateId: row.id,
              version: 1,
              ...bodyColumns(input.body),
              note: input.note,
              createdById: input.userId,
            },
          });
          return toRecord(row);
        }),
      'name',
    );
  }

  saveVersion(
    context: TenantContext,
    templateId: string,
    expectedVersion: number,
    input: TemplateWrite,
  ): Promise<TemplateRecord | null> {
    const scoped = this.clients.forTenant(context.tenantId);
    return withDomainErrors(
      () =>
        scoped.$transaction(async (tx) => {
          const { count } = await tx.template.updateMany({
            where: { id: templateId, currentVersion: expectedVersion },
            data: {
              name: input.name,
              description: input.description,
              ...bodyColumns(input.body),
              currentVersion: expectedVersion + 1,
              updatedById: input.userId,
            },
          });
          if (count === 0) return null;
          await tx.templateVersion.create({
            data: {
              tenantId: context.tenantId,
              templateId,
              version: expectedVersion + 1,
              ...bodyColumns(input.body),
              note: input.note,
              createdById: input.userId,
            },
          });
          const row = await tx.template.findFirst({
            where: { id: templateId },
            select: RECORD_SELECT,
          });
          return row ? toRecord(row) : null;
        }),
      'name',
    );
  }

  async listVersions(
    context: TenantContext,
    templateId: string,
  ): Promise<TemplateVersionSummary[]> {
    const rows = await this.clients.forTenant(context.tenantId).templateVersion.findMany({
      where: { templateId },
      select: { version: true, subject: true, note: true, createdById: true, createdAt: true },
      orderBy: { version: 'desc' },
      take: 100,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.createdById))] } },
      select: { id: true, name: true, email: true },
    });
    const names = new Map(users.map((user) => [user.id, user.name ?? user.email]));
    return rows.map((row) => ({ ...row, createdByName: names.get(row.createdById) ?? null }));
  }

  async findVersion(
    context: TenantContext,
    templateId: string,
    version: number,
  ): Promise<TemplateVersionRecord | null> {
    const row = await this.clients.forTenant(context.tenantId).templateVersion.findFirst({
      where: { templateId, version },
    });
    if (!row) return null;
    return {
      version: row.version,
      subject: row.subject,
      note: row.note,
      createdById: row.createdById,
      createdByName: null,
      createdAt: row.createdAt,
      body: toBody(row),
    };
  }

  async delete(context: TenantContext, templateId: string): Promise<boolean> {
    const { count } = await this.clients
      .forTenant(context.tenantId)
      .template.deleteMany({ where: { id: templateId } });
    return count > 0;
  }
}
