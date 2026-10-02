/** Puertos del módulo de campañas y entregas. */
import type { Page } from '@/core/shared/pagination';
import type { TenantContext } from '@/core/shared/tenant-context';
import type {
  CampaignAudience,
  CampaignRecord,
  CampaignStatus,
  CampaignSummary,
  UpdateCampaignInput,
} from './campaign';
import type {
  CampaignStats,
  DailyActivity,
  DeliveryForSend,
  DeliveryStatus,
  DeliveryView,
  LinkStats,
  NewDeliveryEvent,
} from './delivery';

export interface CompiledCampaign {
  subject: string;
  subjectB: string | null;
  html: string;
  text: string;
}

export interface CampaignLinkRecord {
  id: string;
  position: number;
  url: string;
}

export interface CampaignRef {
  tenantId: string;
  tenantSlug: string;
  id: string;
  version: number;
}

export type CampaignDraftPatch = Omit<UpdateCampaignInput, 'campaignId' | 'expectedVersion'>;

export interface CampaignTransitionPatch {
  scheduledAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  dispatchedAt?: Date | null;
  recipientCount?: number;
  error?: string | null;
  body?: CampaignRecord['body'];
  templateVersion?: number | null;
  /** Incrementa la versión: invalida los jobs de despacho programados anteriormente. */
  bumpVersion?: boolean;
}

export interface CampaignRepository {
  list(context: TenantContext): Promise<CampaignSummary[]>;
  findById(context: TenantContext, campaignId: string): Promise<CampaignRecord | null>;
  create(
    context: TenantContext,
    input: {
      name: string;
      templateId: string;
      senderIdentityId: string | null;
      createdById: string;
      copyFrom?: CampaignDraftPatch | undefined;
    },
  ): Promise<CampaignRecord>;
  /** Solo en DRAFT y si la versión coincide (concurrencia optimista). Null si no aplica. */
  updateDraft(
    context: TenantContext,
    campaignId: string,
    expectedVersion: number,
    patch: CampaignDraftPatch,
  ): Promise<CampaignRecord | null>;
  /** Cambio de estado atómico desde uno de `from`. Devuelve si se aplicó. */
  transition(
    context: TenantContext,
    campaignId: string,
    from: readonly CampaignStatus[],
    to: CampaignStatus,
    patch?: CampaignTransitionPatch,
  ): Promise<boolean>;
  saveCompiled(
    context: TenantContext,
    campaignId: string,
    compiled: CompiledCampaign,
    links: readonly string[],
  ): Promise<void>;
  findCompiled(context: TenantContext, campaignId: string): Promise<CompiledCampaign | null>;
  findLink(
    context: TenantContext,
    campaignId: string,
    linkId: string,
  ): Promise<CampaignLinkRecord | null>;
  findLinks(context: TenantContext, campaignId: string): Promise<CampaignLinkRecord[]>;
  setDispatchCursor(context: TenantContext, campaignId: string, cursor: string): Promise<void>;
  delete(context: TenantContext, campaignId: string): Promise<boolean>;
  /** Programadas con fecha vencida (red de seguridad del planificador). Global. */
  findDue(now: Date): Promise<CampaignRef[]>;
  /** En estado SENDING (para cerrar las que ya terminaron). Global. */
  findSending(): Promise<CampaignRef[]>;
}

export interface DeliveryRepository {
  /** Inserta las entregas que no existan (único por campaña y contacto). */
  createBatch(
    context: TenantContext,
    campaignId: string,
    providerConfigId: string,
    rows: ReadonlyArray<{ contactId: string; email: string; variant: string | null }>,
  ): Promise<void>;
  queuedIds(
    context: TenantContext,
    campaignId: string,
    afterId: string | null,
    limit: number,
  ): Promise<string[]>;
  queuedIdsForContacts(
    context: TenantContext,
    campaignId: string,
    contactIds: readonly string[],
  ): Promise<string[]>;
  findForSend(
    context: TenantContext,
    deliveryId: string,
    topicId: string | null,
  ): Promise<DeliveryForSend | null>;
  /** QUEUED → SENDING (incrementa intentos). False si otro worker la tomó. */
  claim(context: TenantContext, deliveryId: string, at: Date): Promise<boolean>;
  /** SENDING → QUEUED (para reintentar o al pausar). */
  release(context: TenantContext, deliveryId: string, lastError: string | null): Promise<void>;
  markSent(
    context: TenantContext,
    deliveryId: string,
    providerMessageId: string,
    at: Date,
  ): Promise<void>;
  markFinal(
    context: TenantContext,
    deliveryId: string,
    status: Extract<DeliveryStatus, 'FAILED' | 'SUPPRESSED' | 'CANCELLED'>,
    lastError: string | null,
  ): Promise<void>;
  cancelQueued(context: TenantContext, campaignId: string): Promise<number>;
  /** Entregas pendientes (QUEUED o SENDING). */
  countActive(context: TenantContext, campaignId: string): Promise<number>;
  count(context: TenantContext, campaignId: string): Promise<number>;
  stats(context: TenantContext, campaignId: string): Promise<CampaignStats>;
  linkStats(context: TenantContext, campaignId: string): Promise<LinkStats[]>;
  page(
    context: TenantContext,
    campaignId: string,
    query: {
      status?: DeliveryStatus | undefined;
      search?: string | undefined;
      page: number;
      pageSize: number;
    },
  ): Promise<Page<DeliveryView>>;
  /** Entregas SENDING con `claimedAt` anterior a `before` (worker caído). Global. */
  findStale(before: Date): Promise<Array<{ tenantId: string; tenantSlug: string; id: string }>>;
  findForTracking(
    context: TenantContext,
    deliveryId: string,
  ): Promise<{
    id: string;
    campaignId: string;
    contactId: string;
    email: string;
    firstOpenedAt: Date | null;
  } | null>;
  recordOpen(context: TenantContext, deliveryId: string, at: Date, machine: boolean): Promise<void>;
  recordClick(context: TenantContext, deliveryId: string, at: Date): Promise<void>;
  recordUnsubscribe(context: TenantContext, deliveryId: string, at: Date): Promise<void>;
  addEvent(context: TenantContext, event: NewDeliveryEvent): Promise<void>;
  findByProviderMessageId(
    context: TenantContext,
    providerConfigId: string,
    providerMessageId: string,
  ): Promise<{
    id: string;
    campaignId: string;
    contactId: string;
    email: string;
    status: DeliveryStatus;
  } | null>;
  /** Transición monótona por evento del proveedor (no retrocede, p. ej. de BOUNCED a DELIVERED). */
  applyProviderStatus(
    context: TenantContext,
    deliveryId: string,
    status: Extract<DeliveryStatus, 'DELIVERED' | 'BOUNCED' | 'COMPLAINED'>,
    at: Date,
  ): Promise<boolean>;
  dailyActivity(context: TenantContext, since: Date): Promise<DailyActivity[]>;
}

export interface AudienceResolver {
  count(
    context: TenantContext,
    audience: CampaignAudience,
    topicId: string | null,
  ): Promise<number>;
  /** Destinatarios elegibles ordenados por id de contacto (paginación por cursor). */
  page(
    context: TenantContext,
    audience: CampaignAudience,
    topicId: string | null,
    afterContactId: string | null,
    limit: number,
  ): Promise<Array<{ contactId: string; email: string }>>;
}

export interface CampaignQueue {
  enqueueDispatch(
    context: TenantContext,
    campaignId: string,
    version: number,
    delayMs: number,
  ): Promise<void>;
  enqueueSends(context: TenantContext, deliveryIds: readonly string[]): Promise<void>;
}

export type ThrottleResult = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * Límite de envío:
 * - `rate`: ritmo uniforme (como mucho `points` en cualquier ventana deslizante de
 *   `durationSeconds`); es lo que miden los proveedores (p. ej. SES 14/s) y evita ráfagas.
 * - `quota`: cupo por ventana fija (p. ej. 10.000/día o el límite por hora de una campaña).
 */
export interface SendLimit {
  mode: 'rate' | 'quota';
  points: number;
  durationSeconds: number;
}

/** Límites de envío compartidos por todos los workers (Redis). */
export interface SendThrottle {
  acquire(scope: string, limits: ReadonlyArray<SendLimit>): Promise<ThrottleResult>;
}

/** URL firmadas de seguimiento de una entrega. */
export interface TrackingLinks {
  openUrl(tenantId: string, deliveryId: string): string;
  clickUrl(tenantId: string, deliveryId: string, linkId: string): string;
  unsubscribeUrl(tenantId: string, deliveryId: string): string;
  preferencesUrl(tenantId: string, deliveryId: string): string;
  /** Indica si la URL es la descarga de un documento (para registrar DOWNLOADED). */
  isDocumentDownload(url: string): boolean;
}

/** Inserta el píxel de apertura y sustituye los enlaces por variables de seguimiento. */
export interface EmailInstrumenter {
  instrument(
    html: string,
    options: { trackOpens: boolean; trackClicks: boolean },
  ): { html: string; links: string[] };
}

/** Preferencias y bajas del destinatario. */
export interface RecipientPreferencesRepository {
  load(
    context: TenantContext,
    contactId: string,
  ): Promise<{
    email: string;
    status: string;
    topics: Array<{ id: string; name: { es: string; en: string }; subscribed: boolean }>;
  } | null>;
  setTopic(
    context: TenantContext,
    contactId: string,
    topicId: string,
    subscribed: boolean,
  ): Promise<void>;
  /** Marca el contacto con el estado indicado y añade la supresión correspondiente. */
  suppress(
    context: TenantContext,
    contact: { id: string; email: string },
    reason: 'UNSUBSCRIBE' | 'HARD_BOUNCE' | 'COMPLAINT' | 'INVALID',
    source: string,
  ): Promise<void>;
}
