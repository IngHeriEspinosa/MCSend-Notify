/**
 * Privacidad (RGPD): retención limitada de datos de actividad y derecho de supresión de un
 * contacto.
 *
 * - Retención: los eventos de seguimiento y el uso de IA se conservan 13 meses (comparativas
 *   interanuales); los eventos crudos de proveedores, 90 días; el registro de webhooks
 *   salientes, 30 días. La auditoría es inmutable y no se purga.
 * - Supresión: se elimina el contacto con sus listas, etiquetas y suscripciones, y se anonimiza
 *   el email de sus entregas (las estadísticas de campaña se conservan sin datos personales).
 *   Si el contacto estaba en la lista de supresión, se mantiene: es el mínimo imprescindible para
 *   no volver a escribirle si alguien lo importa de nuevo (interés legítimo).
 */
import type { AuditLogger } from '@/core/audit/audit-log';
import { assertCan } from '@/core/identity/permissions';
import { DomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';

export const RETENTION_TARGETS = [
  'delivery_events',
  'ai_usage',
  'inbound_webhook_events',
  'webhook_deliveries',
] as const;
export type RetentionTarget = (typeof RETENTION_TARGETS)[number];

/** Antigüedad máxima en días de cada tabla. */
export const RETENTION_DAYS: Record<RetentionTarget, number> = {
  delivery_events: 396,
  ai_usage: 396,
  inbound_webhook_events: 90,
  webhook_deliveries: 30,
};

const DAY_MS = 86_400_000;

export interface RetentionRepository {
  /** Borra (por lotes) las filas anteriores a `before`; devuelve cuántas se borraron. */
  purge(target: RetentionTarget, before: Date): Promise<number>;
}

export class ApplyRetentionUseCase {
  constructor(private readonly deps: { retention: RetentionRepository; clock: Clock }) {}

  async execute(): Promise<Record<RetentionTarget, number>> {
    const now = this.deps.clock.now().getTime();
    const result: Record<RetentionTarget, number> = {
      delivery_events: 0,
      ai_usage: 0,
      inbound_webhook_events: 0,
      webhook_deliveries: 0,
    };
    for (const target of RETENTION_TARGETS) {
      result[target] = await this.deps.retention.purge(
        target,
        new Date(now - RETENTION_DAYS[target] * DAY_MS),
      );
    }
    return result;
  }
}

export interface PersonalDataEraser {
  /**
   * Elimina el contacto y anonimiza sus entregas en una transacción. Devuelve null si el
   * contacto no existe y, si existe, el número de entregas anonimizadas.
   */
  eraseContact(context: TenantContext, contactId: string): Promise<{ deliveries: number } | null>;
}

export class EraseContactUseCase {
  constructor(private readonly deps: { eraser: PersonalDataEraser; audit: AuditLogger }) {}

  async execute(context: TenantContext, contactId: string): Promise<{ deliveries: number }> {
    assertCan(context, 'contact:delete');
    const result = await this.deps.eraser.eraseContact(context, contactId);
    if (!result) throw new DomainError('NOT_FOUND', 'Contacto inexistente');
    // Sin datos personales en la auditoría: solo el identificador y el alcance.
    await this.deps.audit.record(context, {
      action: 'contact.erased',
      entityType: 'contact',
      entityId: contactId,
      metadata: { deliveriesAnonymized: result.deliveries },
    });
    return result;
  }
}
