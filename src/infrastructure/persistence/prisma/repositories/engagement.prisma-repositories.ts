/**
 * Preferencias de los destinatarios (temas y bajas), eventos de webhooks entrantes y tokens de
 * recuperación de contraseña.
 */
import type { RecipientPreferencesRepository } from '@/core/campaigns/ports';
import type {
  InboundEventRepository,
  NormalizedProviderEvent,
  StoredProviderEvent,
} from '@/core/campaigns/use-cases/provider-events.use-cases';
import { normalizeEmail } from '@/core/identity/email';
import type { PasswordResetTokenRepository } from '@/core/identity/use-cases/password-reset.use-cases';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { PrismaClient } from '../generated/client';
import { isUniqueViolation } from '../prisma-errors';
import type { TenantClientCache } from '../tenant-scope.extension';

const CONTACT_STATUS_BY_REASON = {
  UNSUBSCRIBE: 'UNSUBSCRIBED',
  HARD_BOUNCE: 'BOUNCED',
  COMPLAINT: 'COMPLAINED',
  INVALID: 'INVALID',
} as const;

function localized(value: unknown): { es: string; en: string } {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const es = typeof record.es === 'string' ? record.es : '';
  const en = typeof record.en === 'string' ? record.en : es;
  return { es, en };
}

export class PrismaRecipientPreferencesRepository implements RecipientPreferencesRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async load(context: TenantContext, contactId: string) {
    const scoped = this.clients.forTenant(context.tenantId);
    const contact = await scoped.contact.findFirst({
      where: { id: contactId },
      select: {
        email: true,
        status: true,
        topicSubscriptions: { select: { topicId: true, subscribed: true } },
      },
    });
    if (!contact) return null;
    const topics = await scoped.topic.findMany({
      select: { id: true, name: true, isDefault: true },
      orderBy: { createdAt: 'asc' },
    });
    const decided = new Map(
      contact.topicSubscriptions.map((item) => [item.topicId, item.subscribed]),
    );
    return {
      email: contact.email,
      status: contact.status,
      topics: topics.map((topic) => ({
        id: topic.id,
        name: localized(topic.name),
        subscribed: decided.get(topic.id) ?? topic.isDefault,
      })),
    };
  }

  async setTopic(context: TenantContext, contactId: string, topicId: string, subscribed: boolean) {
    await this.clients.forTenant(context.tenantId).contactTopicSubscription.upsert({
      where: { contactId_topicId: { contactId, topicId } },
      create: { tenantId: context.tenantId, contactId, topicId, subscribed },
      update: { subscribed },
    });
  }

  async suppress(
    context: TenantContext,
    contact: { id: string; email: string },
    reason: 'UNSUBSCRIBE' | 'HARD_BOUNCE' | 'COMPLAINT' | 'INVALID',
    source: string,
  ) {
    const emailNormalized = normalizeEmail(contact.email);
    await this.clients.forTenant(context.tenantId).$transaction(async (tx) => {
      await tx.suppression.upsert({
        where: { tenantId_emailNormalized: { tenantId: context.tenantId, emailNormalized } },
        create: { tenantId: context.tenantId, emailNormalized, reason, source },
        // Se conserva el primer motivo registrado.
        update: {},
      });
      await tx.contact.updateMany({
        where: { id: contact.id, status: 'ACTIVE' },
        data: { status: CONTACT_STATUS_BY_REASON[reason] },
      });
    });
  }
}

export class PrismaInboundEventRepository implements InboundEventRepository {
  constructor(private readonly clients: TenantClientCache) {}

  async insert(
    context: TenantContext,
    providerConfigId: string,
    event: NormalizedProviderEvent,
  ): Promise<string | null> {
    try {
      const row = await this.clients.forTenant(context.tenantId).inboundWebhookEvent.create({
        data: {
          tenantId: context.tenantId,
          providerConfigId,
          providerEventId: event.providerEventId,
          type: event.type,
          payload: {
            providerMessageId: event.providerMessageId,
            occurredAt: event.occurredAt.toISOString(),
            ...(event.detail ? { detail: event.detail } : {}),
          },
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async findById(context: TenantContext, eventId: string): Promise<StoredProviderEvent | null> {
    const row = await this.clients.forTenant(context.tenantId).inboundWebhookEvent.findFirst({
      where: { id: eventId },
    });
    if (!row) return null;
    const payload =
      typeof row.payload === 'object' && row.payload !== null
        ? (row.payload as Record<string, unknown>)
        : {};
    const type = row.type;
    if (
      type !== 'DELIVERED' &&
      type !== 'HARD_BOUNCE' &&
      type !== 'SOFT_BOUNCE' &&
      type !== 'COMPLAINT'
    )
      return null;
    return {
      id: row.id,
      providerConfigId: row.providerConfigId,
      providerEventId: row.providerEventId,
      type,
      providerMessageId:
        typeof payload.providerMessageId === 'string' ? payload.providerMessageId : '',
      occurredAt:
        typeof payload.occurredAt === 'string' ? new Date(payload.occurredAt) : row.receivedAt,
      detail: typeof payload.detail === 'string' ? payload.detail : undefined,
      processedAt: row.processedAt,
    };
  }

  async markProcessed(context: TenantContext, eventId: string, at: Date): Promise<void> {
    await this.clients
      .forTenant(context.tenantId)
      .inboundWebhookEvent.updateMany({ where: { id: eventId }, data: { processedAt: at } });
  }
}

/** Tokens en la tabla `verification_tokens` de Auth.js con el identificador `password-reset:{userId}`. */
export class PrismaPasswordResetTokenRepository implements PasswordResetTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async replace(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    const identifier = `password-reset:${userId}`;
    await this.prisma.$transaction([
      this.prisma.verificationToken.deleteMany({ where: { identifier } }),
      this.prisma.verificationToken.create({
        data: { identifier, token: tokenHash, expires: expiresAt },
      }),
    ]);
  }

  async consume(tokenHash: string, now: Date): Promise<string | null> {
    const row = await this.prisma.verificationToken.findFirst({
      where: { token: tokenHash, identifier: { startsWith: 'password-reset:' } },
    });
    if (!row) return null;
    // Borrado condicionado: un token solo se puede consumir una vez aunque lleguen dos peticiones.
    const { count } = await this.prisma.verificationToken.deleteMany({
      where: { identifier: row.identifier, token: tokenHash },
    });
    if (count === 0 || row.expires <= now) return null;
    return row.identifier.slice('password-reset:'.length);
  }
}
