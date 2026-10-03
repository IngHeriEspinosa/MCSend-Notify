/** Dobles de prueba de IA, novedades, automatizaciones y aprobaciones. */
import type { FoundLink, LinkFinder } from '@/core/ai/guardrails';
import {
  AiModelError,
  type AiConnection,
  type AiSettingsRepository,
  type AiSettingsWrite,
  type AiUsageRepository,
  type AiUsageSummary,
  type LanguageModel,
  type LanguageModelFactory,
  type NewAiUsage,
  type StoredAiSettings,
  type StructuredRequest,
  type StructuredResponse,
} from '@/core/ai/ports';
import type { TokenUsage } from '@/core/ai/pricing';
import type { FetchedFeed, FetchedPage, SourceFetcher } from '@/core/ai/sources';
import type {
  ApprovalRecord,
  ApprovalStatus,
  AutomationRecord,
  AutomationRunRecord,
  AutomationRunStatus,
} from '@/core/automations/automation';
import type {
  ApprovalRepository,
  AutomationRef,
  AutomationRepository,
  AutomationRunRepository,
  AutomationScheduler,
  AutomationWrite,
  MemberDirectory,
  RunPatch,
  TenantMemberContact,
} from '@/core/automations/ports';
import type { ChangelogEntryView, ChangelogRepository } from '@/core/changelog/changelog';
import type { SystemMailMessage, SystemMailQueue } from '@/core/identity/system-mail';
import type { ProviderStatus } from '@/core/providers/provider-config';
import type { SecretCipher } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import { uuid } from './sending.fakes';

/** Detector de enlaces sencillo para tests del dominio (http(s) y `www.`). */
export const regexLinkFinder: LinkFinder = {
  find(text: string): FoundLink[] {
    return [...text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi)].map((match) => {
      const raw = match[0].replace(/[.,;:!?]+$/, '');
      return {
        start: match.index,
        end: match.index + raw.length,
        url: raw.startsWith('www.') ? `http://${raw}` : raw,
      };
    });
  },
};

export const reversibleCipher: SecretCipher = {
  encrypt: (plaintext, aad) => `enc(${aad})${plaintext}`,
  decrypt: (payload, aad) => {
    const prefix = `enc(${aad})`;
    if (!payload.startsWith(prefix)) throw new Error('AAD incorrecto');
    return payload.slice(prefix.length);
  },
};

export const USAGE: TokenUsage = {
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

type Scripted = { value: unknown } | { error: Error };

/** Modelo programable: devuelve en orden las respuestas o errores encolados y registra las peticiones. */
export class FakeLanguageModelFactory implements LanguageModelFactory {
  readonly requests: Array<{ connection: AiConnection; request: StructuredRequest<unknown> }> = [];
  private readonly script: Scripted[] = [];

  respond(value: unknown): this {
    this.script.push({ value });
    return this;
  }

  fail(error: Error): this {
    this.script.push({ error });
    return this;
  }

  create(connection: AiConnection): LanguageModel {
    return {
      model: connection.model,
      generateObject: async <T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> => {
        this.requests.push({ connection, request });
        const next = this.script.shift();
        if (!next) throw new AiModelError('UNAVAILABLE', 'Sin respuesta programada');
        if ('error' in next) throw next.error;
        return { value: request.schema.parse(next.value), model: connection.model, usage: USAGE };
      },
    };
  }
}

export function aiSettings(overrides: Partial<StoredAiSettings> = {}): StoredAiSettings {
  return {
    id: '66666666-6666-7666-8666-666666666666',
    source: 'OWN',
    kind: 'ANTHROPIC',
    hasApiKey: true,
    credentialsEnc:
      'enc(11111111-1111-7111-8111-111111111111:ai_settings:66666666-6666-7666-8666-666666666666)sk-ant-test',
    baseUrl: null,
    defaultModel: 'claude-opus-5-5',
    fastModel: 'claude-haiku-4-5',
    monthlyBudgetUsd: 10,
    inputPricePerMTok: null,
    outputPricePerMTok: null,
    status: 'ACTIVE',
    lastError: null,
    lastVerifiedAt: null,
    configVersion: 1,
    ...overrides,
  };
}

export class InMemoryAiSettingsRepository implements AiSettingsRepository {
  constructor(public settings: StoredAiSettings | null = aiSettings()) {}

  async find() {
    return this.settings;
  }

  async save(_context: TenantContext, id: string, write: AiSettingsWrite) {
    this.settings = {
      ...write,
      id,
      hasApiKey: write.credentialsEnc !== null,
      status: 'ACTIVE',
      lastError: null,
      lastVerifiedAt: null,
      configVersion: (this.settings?.configVersion ?? 0) + 1,
    };
    return this.settings;
  }

  async setStatus(
    _context: TenantContext,
    status: ProviderStatus,
    lastError: string | null,
    verifiedAt: Date | null,
  ) {
    if (this.settings) {
      this.settings = {
        ...this.settings,
        status,
        lastError,
        lastVerifiedAt: verifiedAt ?? this.settings.lastVerifiedAt,
      };
    }
  }

  async delete() {
    const existed = this.settings !== null;
    this.settings = null;
    return existed;
  }
}

export class InMemoryAiUsageRepository implements AiUsageRepository {
  readonly entries: Array<NewAiUsage & { createdAt: Date }> = [];
  spent = 0;

  async record(_context: TenantContext, entry: NewAiUsage) {
    this.entries.push({ ...entry, createdAt: new Date() });
    this.spent += entry.costMicros;
  }

  async spentSince() {
    return this.spent;
  }

  async summary(_context: TenantContext, since: Date): Promise<AiUsageSummary> {
    return {
      since,
      calls: this.entries.length,
      errors: this.entries.filter((entry) => entry.status !== 'OK').length,
      costMicros: this.spent,
      byPurpose: [],
    };
  }
}

export class FakeSourceFetcher implements SourceFetcher {
  pages = new Map<string, FetchedPage | Error>();
  feeds = new Map<string, FetchedFeed | Error>();

  async fetchPage(url: string): Promise<FetchedPage> {
    const page = this.pages.get(url);
    if (!page) throw new Error(`Página no programada: ${url}`);
    if (page instanceof Error) throw page;
    return page;
  }

  async fetchFeed(url: string): Promise<FetchedFeed> {
    const feed = this.feeds.get(url);
    if (!feed) throw new Error(`Feed no programado: ${url}`);
    if (feed instanceof Error) throw feed;
    return feed;
  }
}

export class InMemoryChangelogRepository implements ChangelogRepository {
  readonly entries: ChangelogEntryView[] = [];

  add(
    entry: Partial<ChangelogEntryView> & { title: string; publishedAt: Date },
  ): ChangelogEntryView {
    const record: ChangelogEntryView = {
      id: uuid(),
      externalId: null,
      version: null,
      bodyMd: '',
      category: 'FEATURE',
      consumedByRunId: null,
      consumedAt: null,
      createdAt: entry.publishedAt,
      ...entry,
    };
    this.entries.push(record);
    return record;
  }

  async list(_context: TenantContext, limit: number) {
    return this.entries.slice(0, limit);
  }

  async upsert(_context: TenantContext, input: Parameters<ChangelogRepository['upsert']>[1]) {
    const existing = input.externalId
      ? this.entries.find((entry) => entry.externalId === input.externalId)
      : undefined;
    if (existing) {
      Object.assign(existing, input);
      return { entry: existing, created: false };
    }
    return { entry: this.add(input), created: true };
  }

  async delete(_context: TenantContext, entryId: string) {
    const index = this.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  async findForSources(_context: TenantContext, since: Date, onlyNew: boolean, limit: number) {
    return this.entries
      .filter((entry) => entry.publishedAt >= since && (!onlyNew || entry.consumedByRunId === null))
      .slice(0, limit);
  }

  async markConsumed(_context: TenantContext, ids: readonly string[], runId: string, at: Date) {
    for (const entry of this.entries) {
      if (ids.includes(entry.id) && entry.consumedByRunId === null) {
        entry.consumedByRunId = runId;
        entry.consumedAt = at;
      }
    }
  }
}

export class InMemoryAutomationRepository implements AutomationRepository {
  readonly automations = new Map<string, AutomationRecord>();

  async list() {
    return [...this.automations.values()].map((automation) => ({
      id: automation.id,
      name: automation.name,
      enabled: automation.enabled,
      schedule: automation.schedule,
      timezone: automation.timezone,
      lastRunAt: automation.lastRunAt,
      lastRunStatus: null,
    }));
  }

  async findById(_context: TenantContext, id: string) {
    return this.automations.get(id) ?? null;
  }

  async create(_context: TenantContext, input: AutomationWrite & { createdById: string }) {
    const now = new Date();
    const record: AutomationRecord = {
      id: uuid(),
      enabled: false,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    this.automations.set(record.id, record);
    return record;
  }

  async update(_context: TenantContext, id: string, input: AutomationWrite) {
    const current = this.automations.get(id);
    if (!current) throw new Error('inexistente');
    const record = { ...current, ...input };
    this.automations.set(id, record);
    return record;
  }

  async setEnabled(_context: TenantContext, id: string, enabled: boolean) {
    const current = this.automations.get(id);
    if (!current) return false;
    this.automations.set(id, { ...current, enabled });
    return true;
  }

  async setLastRun(_context: TenantContext, id: string, at: Date) {
    const current = this.automations.get(id);
    if (current) this.automations.set(id, { ...current, lastRunAt: at });
  }

  async delete(_context: TenantContext, id: string) {
    return this.automations.delete(id);
  }

  async listEnabled(): Promise<AutomationRef[]> {
    return [...this.automations.values()]
      .filter((automation) => automation.enabled)
      .map((automation) => ({
        id: automation.id,
        tenantId: '11111111-1111-7111-8111-111111111111',
        tenantSlug: 'mcsupport',
        schedule: automation.schedule,
        timezone: automation.timezone,
      }));
  }
}

export class InMemoryRunRepository implements AutomationRunRepository {
  readonly runs = new Map<string, AutomationRunRecord>();
  approvals?: InMemoryApprovalRepository;

  async start(
    _context: TenantContext,
    input: { automationId: string; idempotencyKey: string; trigger: 'schedule' | 'manual' },
  ) {
    const existing = [...this.runs.values()].find(
      (run) =>
        run.automationId === input.automationId && run.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return { run: existing, created: false };
    const run: AutomationRunRecord = {
      id: uuid(),
      ...input,
      status: 'RUNNING',
      campaignId: null,
      templateId: null,
      sources: [],
      removedLinks: [],
      error: null,
      startedAt: new Date(),
      finishedAt: null,
      approval: null,
    };
    this.runs.set(run.id, run);
    return { run, created: true };
  }

  async restart(_context: TenantContext, runId: string) {
    const run = this.runs.get(runId);
    if (run?.status !== 'FAILED') return false;
    this.runs.set(runId, { ...run, status: 'RUNNING', error: null, finishedAt: null });
    return true;
  }

  async update(_context: TenantContext, runId: string, patch: RunPatch) {
    const run = this.runs.get(runId);
    if (run) this.runs.set(runId, { ...run, ...patch });
  }

  async transition(
    context: TenantContext,
    runId: string,
    from: readonly AutomationRunStatus[],
    patch: RunPatch & { status: AutomationRunStatus },
  ) {
    const run = this.runs.get(runId);
    if (!run || !from.includes(run.status)) return false;
    await this.update(context, runId, patch);
    return true;
  }

  async findById(_context: TenantContext, runId: string) {
    return this.runs.get(runId) ?? null;
  }

  async list(_context: TenantContext, automationId: string) {
    return [...this.runs.values()].filter((run) => run.automationId === automationId);
  }
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  readonly approvals = new Map<string, ApprovalRecord>();

  async create(
    _context: TenantContext,
    input: Parameters<ApprovalRepository['create']>[1],
  ): Promise<ApprovalRecord> {
    const record: ApprovalRecord = {
      id: uuid(),
      ...input,
      automationId: 'automation',
      automationName: 'Resumen semanal',
      status: 'PENDING',
      decidedById: null,
      decidedAt: null,
      comment: null,
      createdAt: new Date(),
    };
    this.approvals.set(record.id, record);
    return record;
  }

  async findById(_context: TenantContext, id: string) {
    return this.approvals.get(id) ?? null;
  }

  async list(_context: TenantContext, status: ApprovalStatus | null) {
    return [...this.approvals.values()].filter((approval) => !status || approval.status === status);
  }

  async countPending() {
    return [...this.approvals.values()].filter((approval) => approval.status === 'PENDING').length;
  }

  async decide(
    _context: TenantContext,
    id: string,
    decision: Parameters<ApprovalRepository['decide']>[2],
  ) {
    const approval = this.approvals.get(id);
    if (approval?.status !== 'PENDING') return false;
    this.approvals.set(id, {
      ...approval,
      status: decision.status,
      decidedById: decision.decidedById,
      decidedAt: decision.at,
      comment: decision.comment,
    });
    return true;
  }

  async findExpired(now: Date) {
    return [...this.approvals.values()]
      .filter((approval) => approval.status === 'PENDING' && approval.expiresAt <= now)
      .map((approval) => ({
        id: approval.id,
        tenantId: '11111111-1111-7111-8111-111111111111',
        tenantSlug: 'mcsupport',
      }));
  }
}

export class FakeMemberDirectory implements MemberDirectory {
  constructor(public members: TenantMemberContact[] = []) {}

  async findMembers(_context: TenantContext, userIds: readonly string[]) {
    return this.members.filter((member) => userIds.includes(member.userId));
  }
}

export class RecordingAutomationScheduler implements AutomationScheduler {
  readonly upserts: AutomationRef[] = [];
  readonly removed: string[] = [];
  readonly runs: Array<{ automationId: string; key: string; trigger: string }> = [];

  async upsert(ref: AutomationRef) {
    this.upserts.push(ref);
  }

  async remove(automationId: string) {
    this.removed.push(automationId);
  }

  async enqueueRun(_context: TenantContext, automationId: string, key: string, trigger: string) {
    this.runs.push({ automationId, key, trigger });
  }
}

export class RecordingMailQueue implements SystemMailQueue {
  readonly messages: SystemMailMessage[] = [];
  async enqueue(message: SystemMailMessage) {
    this.messages.push(message);
  }
}
