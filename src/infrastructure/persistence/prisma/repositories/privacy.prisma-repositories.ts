/**
 * Privacidad: purga por antigüedad (lotes pequeños para no bloquear tablas grandes) y supresión
 * de un contacto con anonimización de sus entregas en una transacción.
 */
import type {
  PersonalDataEraser,
  RetentionRepository,
  RetentionTarget,
} from '@/core/privacy/privacy';
import type { TenantContext } from '@/core/shared/tenant-context';
import { Prisma, type PrismaClient } from '../generated/client';

/** Columna de fecha de cada tabla (identificadores fijos, nunca datos del usuario). */
const DATE_COLUMNS: Record<RetentionTarget, string> = {
  delivery_events: 'occurred_at',
  ai_usage: 'created_at',
  inbound_webhook_events: 'received_at',
  webhook_deliveries: 'created_at',
};

const BATCH_SIZE = 5_000;

export class PrismaRetentionRepository implements RetentionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async purge(target: RetentionTarget, before: Date): Promise<number> {
    const table = Prisma.raw(`"${target}"`);
    const column = Prisma.raw(`"${DATE_COLUMNS[target]}"`);
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM ${table} WHERE ctid IN (
          SELECT ctid FROM ${table} WHERE ${column} < ${before} LIMIT ${BATCH_SIZE}
        )`;
      total += deleted;
      if (deleted < BATCH_SIZE) return total;
    }
  }
}

export class PrismaPersonalDataEraser implements PersonalDataEraser {
  constructor(private readonly prisma: PrismaClient) {}

  eraseContact(context: TenantContext, contactId: string) {
    const tenantId = context.tenantId;
    return this.prisma.$transaction(async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, tenantId },
        select: { id: true },
      });
      if (!contact) return null;
      await tx.$executeRaw`
        UPDATE delivery_events SET user_agent = NULL
        WHERE tenant_id = ${tenantId}::uuid AND delivery_id IN (
          SELECT id FROM deliveries WHERE tenant_id = ${tenantId}::uuid AND contact_id = ${contactId}::uuid
        )`;
      const deliveries = await tx.$executeRaw`
        UPDATE deliveries SET email = 'erased-' || id::text || '@erased.invalid'
        WHERE tenant_id = ${tenantId}::uuid AND contact_id = ${contactId}::uuid`;
      await tx.contact.deleteMany({ where: { id: contactId, tenantId } });
      return { deliveries };
    });
  }
}
