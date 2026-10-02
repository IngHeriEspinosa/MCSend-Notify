/** Dobles en memoria del envío de campañas para tests unitarios de casos de uso. */
import type { CampaignAudience, CampaignRecord, CampaignStatus } from '@/core/campaigns/campaign';
import type {
  CampaignStats,
  DeliveryForSend,
  DeliveryStatus,
  NewDeliveryEvent,
} from '@/core/campaigns/delivery';
import { DELIVERY_STATUSES } from '@/core/campaigns/delivery';
import type {
  AudienceResolver,
  CampaignLinkRecord,
  CampaignQueue,
  CampaignRepository,
  CampaignTransitionPatch,
  CompiledCampaign,
  DeliveryRepository,
  EmailInstrumenter,
  RecipientPreferencesRepository,
  SendLimit,
  SendThrottle,
  ThrottleResult,
  TrackingLinks,
} from '@/core/campaigns/ports';
import type { ProviderStatus, SenderView } from '@/core/providers/provider-config';
import type {
  EmailProvider,
  EmailProviderGateway,
  OutboundEmail,
  ProviderConfigRepository,
  SendResult,
  SenderRepository,
  StoredProvider,
} from '@/core/providers/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import type { EmailCompiler, PreparedEmail, RenderedEmail } from '@/core/templates/ports';
import type { RecipientVariables } from '@/core/templates/template-variables';

export const TENANT_ID = '11111111-1111-7111-8111-111111111111';
export const PROVIDER_ID = '22222222-2222-7222-8222-222222222222';
export const SENDER_ID = '33333333-3333-7333-8333-333333333333';
export const TOPIC_ID = '44444444-4444-7444-8444-444444444444';

export const ownerContext: TenantContext = {
  tenantId: TENANT_ID,
  tenantSlug: 'mcsupport',
  actor: { type: 'user', userId: 'user-1', role: 'OWNER', isPlatformAdmin: false },
};
export const systemCtx: TenantContext = {
  tenantId: TENANT_ID,
  tenantSlug: 'mcsupport',
  actor: { type: 'system', reason: 'test' },
};

let sequence = 0;
export function uuid(): string {
  sequence += 1;
  return `00000000-0000-7000-8000-${String(sequence).padStart(12, '0')}`;
}

export function campaignRecord(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: uuid(),
    name: 'Campaña',
    status: 'DRAFT',
    scheduledAt: null,
    recipientCount: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-10-02T12:00:00Z'),
    updatedAt: new Date('2026-10-02T12:00:00Z'),
    templateId: 'template-1',
    templateVersion: null,
    body: {
      format: 'MARKDOWN',
      subject: 'Hola {{ contact.first_name }}',
      preheader: 'Novedades',
      locale: 'es',
      content: { markdown: 'Texto' },
    },
    subjectB: null,
    senderIdentityId: SENDER_ID,
    topicId: null,
    audience: { listIds: ['list-1'], segmentIds: [], excludeListIds: [] },
    throttlePerHour: null,
    trackOpens: true,
    trackClicks: true,
    version: 1,
    dispatchCursor: null,
    dispatchedAt: null,
    error: null,
    createdById: 'user-1',
    ...overrides,
  };
}

export class InMemoryCampaignRepository implements CampaignRepository {
  readonly campaigns = new Map<string, CampaignRecord>();
  readonly compiled = new Map<string, CompiledCampaign>();
  readonly links = new Map<string, CampaignLinkRecord[]>();
  /** Estado al que pasa la campaña tras N lecturas (simula una pausa durante el despacho). */
  pauseAfterReads: number | null = null;
  private reads = 0;

  add(record: CampaignRecord) {
    this.campaigns.set(record.id, record);
    return record;
  }
  async list() {
    return [...this.campaigns.values()];
  }
  async findById(_context: TenantContext, id: string) {
    this.reads += 1;
    const record = this.campaigns.get(id);
    if (record && this.pauseAfterReads !== null && this.reads > this.pauseAfterReads) {
      this.campaigns.set(id, { ...record, status: 'PAUSED' });
    }
    const current = this.campaigns.get(id);
    return current ? { ...current } : null;
  }
  async create(_context: TenantContext, input: Parameters<CampaignRepository['create']>[1]) {
    return this.add(
      campaignRecord({
        name: input.name,
        templateId: input.templateId,
        senderIdentityId: input.senderIdentityId,
        ...(input.copyFrom ?? {}),
      }),
    );
  }
  async updateDraft(
    _context: TenantContext,
    id: string,
    expectedVersion: number,
    patch: Parameters<CampaignRepository['updateDraft']>[3],
  ) {
    const record = this.campaigns.get(id);
    if (record?.status !== 'DRAFT' || record.version !== expectedVersion) return null;
    const next = { ...record, ...patch, version: record.version + 1 };
    this.campaigns.set(id, next);
    return next;
  }
  async transition(
    _context: TenantContext,
    id: string,
    from: readonly CampaignStatus[],
    to: CampaignStatus,
    patch: CampaignTransitionPatch = {},
  ) {
    const record = this.campaigns.get(id);
    if (!record || !from.includes(record.status)) return false;
    const { bumpVersion, ...rest } = patch;
    this.campaigns.set(id, {
      ...record,
      ...rest,
      body: rest.body === undefined ? record.body : rest.body,
      status: to,
      version: bumpVersion ? record.version + 1 : record.version,
    });
    return true;
  }
  async saveCompiled(
    _context: TenantContext,
    id: string,
    compiled: CompiledCampaign,
    links: readonly string[],
  ) {
    this.compiled.set(id, compiled);
    this.links.set(
      id,
      links.map((url, position) => ({ id: `link-${position}`, position, url })),
    );
  }
  async findCompiled(_context: TenantContext, id: string) {
    return this.compiled.get(id) ?? null;
  }
  async findLink(_context: TenantContext, campaignId: string, linkId: string) {
    return this.links.get(campaignId)?.find((link) => link.id === linkId) ?? null;
  }
  async findLinks(_context: TenantContext, campaignId: string) {
    return this.links.get(campaignId) ?? [];
  }
  async setDispatchCursor(_context: TenantContext, id: string, cursor: string) {
    const record = this.campaigns.get(id);
    if (record) this.campaigns.set(id, { ...record, dispatchCursor: cursor });
  }
  async delete(_context: TenantContext, id: string) {
    return this.campaigns.delete(id);
  }
  async findDue(now: Date) {
    return [...this.campaigns.values()]
      .filter(
        (record) =>
          record.status === 'SCHEDULED' && (record.scheduledAt?.getTime() ?? 0) <= now.getTime(),
      )
      .map((record) => ({
        id: record.id,
        version: record.version,
        tenantId: TENANT_ID,
        tenantSlug: 'mcsupport',
      }));
  }
  async findSending() {
    return [...this.campaigns.values()]
      .filter((record) => record.status === 'SENDING')
      .map((record) => ({
        id: record.id,
        version: record.version,
        tenantId: TENANT_ID,
        tenantSlug: 'mcsupport',
      }));
  }
}

export interface FakeDelivery {
  id: string;
  campaignId: string;
  contactId: string;
  email: string;
  variant: string | null;
  providerConfigId: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  providerMessageId: string | null;
  claimedAt: Date | null;
  sentAt: Date | null;
  firstOpenedAt: Date | null;
  openCount: number;
  machineOpenOnly: boolean;
  firstClickedAt: Date | null;
  clickCount: number;
  unsubscribedAt: Date | null;
}

export class InMemoryDeliveryRepository implements DeliveryRepository {
  readonly deliveries = new Map<string, FakeDelivery>();
  readonly events: NewDeliveryEvent[] = [];
  /** Contactos no elegibles (dados de baja o suprimidos). */
  readonly ineligible = new Set<string>();

  private ordered(campaignId: string) {
    return [...this.deliveries.values()]
      .filter((item) => item.campaignId === campaignId)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async createBatch(
    _context: TenantContext,
    campaignId: string,
    providerConfigId: string,
    rows: ReadonlyArray<{ contactId: string; email: string; variant: string | null }>,
  ) {
    for (const row of rows) {
      const exists = [...this.deliveries.values()].some(
        (item) => item.campaignId === campaignId && item.contactId === row.contactId,
      );
      if (exists) continue;
      const id = uuid();
      this.deliveries.set(id, {
        id,
        campaignId,
        providerConfigId,
        ...row,
        status: 'QUEUED',
        attempts: 0,
        lastError: null,
        providerMessageId: null,
        claimedAt: null,
        sentAt: null,
        firstOpenedAt: null,
        openCount: 0,
        machineOpenOnly: false,
        firstClickedAt: null,
        clickCount: 0,
        unsubscribedAt: null,
      });
    }
  }
  async queuedIds(
    _context: TenantContext,
    campaignId: string,
    afterId: string | null,
    limit: number,
  ) {
    return this.ordered(campaignId)
      .filter((item) => item.status === 'QUEUED' && (!afterId || item.id > afterId))
      .slice(0, limit)
      .map((item) => item.id);
  }
  async queuedIdsForContacts(
    _context: TenantContext,
    campaignId: string,
    contactIds: readonly string[],
  ) {
    return this.ordered(campaignId)
      .filter((item) => item.status === 'QUEUED' && contactIds.includes(item.contactId))
      .map((item) => item.id);
  }
  async findForSend(_context: TenantContext, id: string): Promise<DeliveryForSend | null> {
    const item = this.deliveries.get(id);
    if (!item) return null;
    return {
      id: item.id,
      campaignId: item.campaignId,
      contactId: item.contactId,
      email: item.email,
      variant: item.variant,
      status: item.status,
      attempts: item.attempts,
      providerConfigId: item.providerConfigId,
      recipient: {
        email: item.email,
        firstName: 'Ana',
        lastName: null,
        company: null,
        attributes: {},
      },
      eligible: !this.ineligible.has(item.contactId),
    };
  }
  private update(id: string, from: DeliveryStatus[], patch: Partial<FakeDelivery>) {
    const item = this.deliveries.get(id);
    if (!item || !from.includes(item.status)) return false;
    this.deliveries.set(id, { ...item, ...patch });
    return true;
  }
  async claim(_context: TenantContext, id: string, at: Date) {
    const item = this.deliveries.get(id);
    return this.update(id, ['QUEUED'], {
      status: 'SENDING',
      attempts: (item?.attempts ?? 0) + 1,
      claimedAt: at,
    });
  }
  async release(_context: TenantContext, id: string, lastError: string | null) {
    this.update(id, ['SENDING'], { status: 'QUEUED', claimedAt: null, lastError });
  }
  async markSent(_context: TenantContext, id: string, providerMessageId: string, at: Date) {
    this.update(id, ['SENDING'], { status: 'SENT', providerMessageId, sentAt: at });
  }
  async markFinal(
    _context: TenantContext,
    id: string,
    status: 'FAILED' | 'SUPPRESSED' | 'CANCELLED',
    lastError: string | null,
  ) {
    this.update(id, ['QUEUED', 'SENDING'], { status, lastError });
  }
  async cancelQueued(_context: TenantContext, campaignId: string) {
    let count = 0;
    for (const item of this.ordered(campaignId))
      if (this.update(item.id, ['QUEUED'], { status: 'CANCELLED' })) count += 1;
    return count;
  }
  async countActive(_context: TenantContext, campaignId: string) {
    return this.ordered(campaignId).filter(
      (item) => item.status === 'QUEUED' || item.status === 'SENDING',
    ).length;
  }
  async count(_context: TenantContext, campaignId: string) {
    return this.ordered(campaignId).length;
  }
  async stats(_context: TenantContext, campaignId: string): Promise<CampaignStats> {
    const items = this.ordered(campaignId);
    const byStatus = Object.fromEntries(
      DELIVERY_STATUSES.map((status) => [
        status,
        items.filter((item) => item.status === status).length,
      ]),
    ) as Record<DeliveryStatus, number>;
    const empty = { sent: 0, opened: 0, clicked: 0 };
    return {
      total: items.length,
      byStatus,
      opened: 0,
      machineOpens: 0,
      clicked: 0,
      unsubscribed: 0,
      downloads: 0,
      variants: { A: empty, B: empty },
    };
  }
  async linkStats() {
    return [];
  }
  async page() {
    return { items: [], total: 0, page: 0, pageSize: 25 };
  }
  async findStale(before: Date) {
    return [...this.deliveries.values()]
      .filter((item) => item.status === 'SENDING' && item.claimedAt && item.claimedAt < before)
      .map((item) => ({ id: item.id, tenantId: TENANT_ID, tenantSlug: 'mcsupport' }));
  }
  async findForTracking(_context: TenantContext, id: string) {
    const item = this.deliveries.get(id);
    return item
      ? {
          id: item.id,
          campaignId: item.campaignId,
          contactId: item.contactId,
          email: item.email,
          firstOpenedAt: item.firstOpenedAt,
        }
      : null;
  }
  async recordOpen(_context: TenantContext, id: string, at: Date, machine: boolean) {
    const item = this.deliveries.get(id);
    if (!item) return;
    this.deliveries.set(id, {
      ...item,
      openCount: item.openCount + 1,
      firstOpenedAt: item.firstOpenedAt ?? at,
      machineOpenOnly: machine ? item.firstOpenedAt === null || item.machineOpenOnly : false,
    });
  }
  async recordClick(_context: TenantContext, id: string, at: Date) {
    const item = this.deliveries.get(id);
    if (item)
      this.deliveries.set(id, {
        ...item,
        clickCount: item.clickCount + 1,
        firstClickedAt: item.firstClickedAt ?? at,
        machineOpenOnly: false,
      });
  }
  async recordUnsubscribe(_context: TenantContext, id: string, at: Date) {
    const item = this.deliveries.get(id);
    if (item && !item.unsubscribedAt) this.deliveries.set(id, { ...item, unsubscribedAt: at });
  }
  async addEvent(_context: TenantContext, event: NewDeliveryEvent) {
    this.events.push(event);
  }
  async findByProviderMessageId(
    _context: TenantContext,
    providerConfigId: string,
    providerMessageId: string,
  ) {
    const item = [...this.deliveries.values()].find(
      (entry) =>
        entry.providerConfigId === providerConfigId &&
        entry.providerMessageId === providerMessageId,
    );
    return item
      ? {
          id: item.id,
          campaignId: item.campaignId,
          contactId: item.contactId,
          email: item.email,
          status: item.status,
        }
      : null;
  }
  async applyProviderStatus(
    _context: TenantContext,
    id: string,
    status: 'DELIVERED' | 'BOUNCED' | 'COMPLAINED',
  ) {
    const allowed: Record<string, DeliveryStatus[]> = {
      DELIVERED: ['SENT'],
      BOUNCED: ['SENT', 'DELIVERED'],
      COMPLAINED: ['SENT', 'DELIVERED'],
    };
    return this.update(id, allowed[status] ?? [], { status });
  }
  async dailyActivity() {
    return [];
  }
}

export class FakeAudience implements AudienceResolver {
  constructor(public recipients: Array<{ contactId: string; email: string }>) {}
  async count() {
    return this.recipients.length;
  }
  async page(
    _context: TenantContext,
    _audience: CampaignAudience,
    _topic: string | null,
    after: string | null,
    limit: number,
  ) {
    return [...this.recipients]
      .sort((a, b) => a.contactId.localeCompare(b.contactId))
      .filter((item) => !after || item.contactId > after)
      .slice(0, limit);
  }
}

export class RecordingCampaignQueue implements CampaignQueue {
  readonly dispatches: Array<{ campaignId: string; version: number; delayMs: number }> = [];
  readonly sends: string[] = [];
  async enqueueDispatch(
    _context: TenantContext,
    campaignId: string,
    version: number,
    delayMs: number,
  ) {
    this.dispatches.push({ campaignId, version, delayMs });
  }
  async enqueueSends(_context: TenantContext, ids: readonly string[]) {
    this.sends.push(...ids);
  }
}

export class FakeThrottle implements SendThrottle {
  result: ThrottleResult = { ok: true };
  readonly scopes: string[] = [];
  readonly limits: Array<ReadonlyArray<SendLimit>> = [];
  async acquire(scope: string, limits: ReadonlyArray<SendLimit>) {
    this.scopes.push(scope);
    this.limits.push(limits);
    return this.result;
  }
}

export class FakeEmailProvider implements EmailProvider {
  readonly sent: OutboundEmail[] = [];
  results: SendResult[] = [];
  async send(email: OutboundEmail): Promise<SendResult> {
    this.sent.push(email);
    return this.results.shift() ?? { ok: true, providerMessageId: `msg-${this.sent.length}` };
  }
  async verify() {
    return { ok: true as const };
  }
}

export class FakeGateway implements EmailProviderGateway {
  status: ProviderStatus = 'ACTIVE';
  rateLimitPerSecond = 10;
  maxPerDay: number | null = null;
  constructor(readonly provider = new FakeEmailProvider()) {}
  async forProvider() {
    return {
      provider: this.provider,
      status: this.status,
      rateLimitPerSecond: this.rateLimitPerSecond,
      maxPerDay: this.maxPerDay,
    };
  }
}

export function storedProvider(overrides: Partial<StoredProvider> = {}): StoredProvider {
  return {
    id: PROVIDER_ID,
    tenantId: TENANT_ID,
    name: 'Mailpit',
    kind: 'SMTP',
    settings: { host: 'mailpit', port: 1025, security: 'none' },
    credentialsEnc: 'cifrado',
    hasCredentials: true,
    endpointToken: 'token-endpoint-1234567890',
    rateLimitPerSecond: 10,
    maxPerDay: null,
    status: 'ACTIVE',
    lastError: null,
    lastVerifiedAt: null,
    configVersion: 1,
    isDefault: true,
    senderCount: 1,
    ...overrides,
  };
}

export class InMemoryProviderRepository implements ProviderConfigRepository {
  readonly providers = new Map<string, StoredProvider>([[PROVIDER_ID, storedProvider()]]);
  async list() {
    return [...this.providers.values()];
  }
  async findById(_context: TenantContext, id: string) {
    return this.providers.get(id) ?? null;
  }
  async findByEndpointToken(token: string) {
    return (
      [...this.providers.values()].find((provider) => provider.endpointToken === token) ?? null
    );
  }
  async create(
    _context: TenantContext,
    id: string,
    endpointToken: string,
    input: Parameters<ProviderConfigRepository['create']>[3],
  ) {
    const provider = storedProvider({
      ...input,
      id,
      endpointToken,
      hasCredentials: input.credentialsEnc !== null,
      senderCount: 0,
    });
    this.providers.set(id, provider);
    return provider;
  }
  async update(
    _context: TenantContext,
    id: string,
    input: Parameters<ProviderConfigRepository['update']>[2],
  ) {
    const current = this.providers.get(id) ?? storedProvider({ id });
    const next = {
      ...current,
      ...input,
      configVersion: current.configVersion + 1,
      hasCredentials: input.credentialsEnc !== null,
    };
    this.providers.set(id, next);
    return next;
  }
  async setStatus(
    _context: TenantContext,
    id: string,
    status: ProviderStatus,
    lastError: string | null,
  ) {
    const current = this.providers.get(id);
    if (current) this.providers.set(id, { ...current, status, lastError });
  }
  async delete(_context: TenantContext, id: string) {
    return this.providers.delete(id);
  }
}

export const sender: SenderView = {
  id: SENDER_ID,
  providerConfigId: PROVIDER_ID,
  providerName: 'Mailpit',
  providerKind: 'SMTP',
  fromName: 'MCSupport',
  fromEmail: 'novedades@multicomputos.com',
  replyTo: null,
  isDefault: true,
  dnsCheck: {
    domain: 'multicomputos.com',
    spf: 'pass',
    dkim: 'pass',
    dmarc: 'pass',
    dkimSelector: 'selector1',
  },
  dnsCheckedAt: null,
};

export class InMemorySenderRepository implements SenderRepository {
  readonly senders = new Map<string, SenderView>([[SENDER_ID, sender]]);
  async list() {
    return [...this.senders.values()];
  }
  async findById(_context: TenantContext, id: string) {
    return this.senders.get(id) ?? null;
  }
  async create(_context: TenantContext, input: Parameters<SenderRepository['create']>[1]) {
    const created = { ...sender, ...input, id: uuid(), dnsCheck: null };
    this.senders.set(created.id, created);
    return created;
  }
  async update(
    _context: TenantContext,
    id: string,
    input: Parameters<SenderRepository['update']>[2],
  ) {
    const updated = { ...(this.senders.get(id) ?? sender), ...input };
    this.senders.set(id, updated);
    return updated;
  }
  async saveDnsCheck() {}
  async delete(_context: TenantContext, id: string) {
    return this.senders.delete(id);
  }
}

export class FakePreferences implements RecipientPreferencesRepository {
  readonly suppressed: Array<{ contactId: string; reason: string; source: string }> = [];
  readonly topics = new Map<string, boolean>();
  status = 'ACTIVE';
  async load() {
    return {
      email: 'ana@cliente.com',
      status: this.status,
      topics: [
        {
          id: TOPIC_ID,
          name: { es: 'Novedades', en: 'News' },
          subscribed: this.topics.get(TOPIC_ID) ?? true,
        },
      ],
    };
  }
  async setTopic(
    _context: TenantContext,
    _contactId: string,
    topicId: string,
    subscribed: boolean,
  ) {
    this.topics.set(topicId, subscribed);
  }
  async suppress(_context: TenantContext, contact: { id: string }, reason: string, source: string) {
    this.suppressed.push({ contactId: contact.id, reason, source });
    this.status = 'UNSUBSCRIBED';
  }
}

export const fakeTrackingLinks: TrackingLinks = {
  openUrl: (_tenant, delivery) => `https://app.test/trk/o/${delivery}`,
  clickUrl: (_tenant, delivery, link) => `https://app.test/trk/c/${delivery}/${link}`,
  unsubscribeUrl: (_tenant, delivery) => `https://app.test/trk/u/${delivery}`,
  preferencesUrl: (_tenant, delivery) => `https://app.test/trk/u/${delivery}`,
  isDocumentDownload: (url) => url.startsWith('https://app.test/trk/d/'),
};

/** Instrumentador simple: un enlace fijo y el píxel. */
export const fakeInstrumenter: EmailInstrumenter = {
  instrument: (html, options) => ({
    html: options.trackClicks ? `${html}<a href="{{ tracking.links.l0 }}">x</a>` : html,
    links: options.trackClicks ? ['https://multicomputos.com/novedades'] : [],
  }),
};

/** Compilador que registra las variables con las que se personaliza cada correo. */
export class RecordingCompiler implements EmailCompiler {
  readonly variables: RecipientVariables[] = [];
  issues: PreparedEmail['issues'] = [];
  async prepare(input: Parameters<EmailCompiler['prepare']>[0]): Promise<PreparedEmail> {
    return {
      subject: input.body.subject,
      html: '<p>{{ contact.first_name }}</p>',
      text: 'texto',
      issues: this.issues,
    };
  }
  async personalize(
    prepared: PreparedEmail,
    variables: RecipientVariables,
  ): Promise<RenderedEmail> {
    this.variables.push(variables);
    const subject = prepared.subject.replace(
      '{{ contact.first_name }}',
      variables.contact.first_name,
    );
    return { subject, html: prepared.html, text: prepared.text, sizeBytes: prepared.html.length };
  }
}
