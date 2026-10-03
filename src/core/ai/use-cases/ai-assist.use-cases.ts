/**
 * Asistencia con IA para editores: borrador de campaña desde fuentes, propuestas de asunto,
 * traducción, ajuste de tono, segmentos en lenguaje natural y resumen de resultados.
 *
 * La IA nunca envía nada: produce contenido que una persona revisa (o que una automatización
 * somete a aprobación). Toda salida pasa por los guardrails antes de llegar a una plantilla.
 */
import { z } from 'zod';
import type { CampaignStats, LinkStats } from '@/core/campaigns/delivery';
import type {
  ContactFieldRepository,
  ContactListRepository,
  TagRepository,
} from '@/core/contacts/ports';
import {
  buildSegmentCatalog,
  OPERATORS_BY_KIND,
  segmentRuleSetSchema,
  type SegmentRule,
  type SegmentRuleSet,
} from '@/core/contacts/segments';
import { assertCan } from '@/core/identity/permissions';
import { DomainError, isDomainError } from '@/core/shared/domain-error';
import type { Clock } from '@/core/shared/ports';
import type { TenantContext } from '@/core/shared/tenant-context';
import {
  MAX_BLOCKS,
  templateBodySchema,
  type EmailBlock,
  type TemplateBody,
} from '@/core/templates/email-content';
import type { BrandingRepository } from '@/core/tenants/branding';
import { SUPPORTED_LOCALES } from '@/core/tenants/tenant';
import { AI_TONES, type AiTone } from '../ai';
import {
  liquidTags,
  LinkPolicy,
  sanitizeMarkdownLinks,
  wrapSources,
  type LinkFinder,
} from '../guardrails';
import {
  DRAFT_ROLE,
  draftOutputSchema,
  languageName,
  REWRITE_ROLE,
  SEGMENT_ROLE,
  segmentOutputSchema,
  SUBJECTS_ROLE,
  subjectsOutputSchema,
  SUMMARY_ROLE,
  summaryOutputSchema,
  systemPrompt,
  textUnitsOutputSchema,
  toneGuide,
  type DraftOutput,
  type SegmentCondition,
  type SegmentOutput,
  type SummaryOutput,
} from '../prompts';
import type { ContentCollector } from '../sources';
import {
  draftSourceSchema,
  MAX_SOURCES,
  summarizeSources,
  type CollectedSource,
  type SourceSummary,
} from '../sources';
import { applyTextUnits, extractTextUnits } from '../text-units';
import type { AiService } from './ai-service';

export const draftCampaignSchema = z.object({
  sources: z.array(draftSourceSchema).min(1).max(MAX_SOURCES),
  instructions: z.string().trim().max(4000).default(''),
  tone: z.enum(AI_TONES).default('professional'),
  locale: z.enum(SUPPORTED_LOCALES),
});
export type DraftCampaignInput = z.infer<typeof draftCampaignSchema>;

export const suggestSubjectsSchema = z.object({ body: templateBodySchema });
export const translateSchema = z.object({
  body: templateBodySchema,
  targetLocale: z.enum(SUPPORTED_LOCALES),
});
export const adjustToneSchema = z.object({ body: templateBodySchema, tone: z.enum(AI_TONES) });
export const segmentFromTextSchema = z.object({
  description: z.string().trim().min(5).max(1000),
  locale: z.enum(SUPPORTED_LOCALES),
});
export const summarizeResultsSchema = z.object({
  campaignId: z.uuid(),
  locale: z.enum(SUPPORTED_LOCALES),
});

export interface DraftResult {
  body: TemplateBody;
  removedLinks: string[];
  sources: SourceSummary[];
  costMicros: number;
}

export interface RewriteResult {
  body: TemplateBody;
  rejected: string[];
  removedLinks: string[];
}

export const SUBJECT_FLAGS = [
  'TOO_SHORT',
  'TOO_LONG',
  'ALL_CAPS',
  'SPAM_WORDS',
  'EXCLAMATIONS',
  'EMOJIS',
] as const;
export type SubjectFlag = (typeof SUBJECT_FLAGS)[number];

export interface SubjectSuggestion {
  text: string;
  rationale: string;
  length: number;
  flags: SubjectFlag[];
}

export interface AiAssistDeps {
  ai: AiService;
  collector: ContentCollector;
  clock: Clock;
  links: LinkFinder;
  branding: Pick<BrandingRepository, 'getEmailProfile'>;
  fields: Pick<ContactFieldRepository, 'list'>;
  lists: Pick<ContactListRepository, 'list'>;
  tags: Pick<TagRepository, 'list'>;
  segments: { previewCount(context: TenantContext, rules: SegmentRuleSet): Promise<number> };
  campaigns: {
    report(
      context: TenantContext,
      campaignId: string,
    ): Promise<{
      campaign: { name: string; subjectB: string | null };
      stats: CampaignStats;
      links: LinkStats[];
    }>;
  };
}

const MAX_CONTEXT_CHARS = 8000;
const SPAM_WORDS =
  /\b(gratis|urgente|oferta exclusiva|garantizado|free|urgent|act now|guaranteed|winner|100\s?%)\b|\${2,}/i;
const EMOJI = /\p{Extended_Pictographic}/gu;

/** Señales de riesgo de un asunto (heurística local, sin IA). */
export function analyzeSubject(text: string): SubjectFlag[] {
  const flags: SubjectFlag[] = [];
  const letters = text.replace(/\{\{[\s\S]*?\}\}/g, '').replace(/[^\p{L}]/gu, '');
  if (text.length < 15) flags.push('TOO_SHORT');
  if (text.length > 70) flags.push('TOO_LONG');
  if (letters.length >= 6 && letters === letters.toUpperCase()) flags.push('ALL_CAPS');
  if (SPAM_WORDS.test(text)) flags.push('SPAM_WORDS');
  if ((text.match(/!/g) ?? []).length > 1) flags.push('EXCLAMATIONS');
  if ((text.match(EMOJI) ?? []).length > 2) flags.push('EMOJIS');
  return flags;
}

function clip(text: string, max: number): string {
  return text.trim().slice(0, max).trim();
}

/** Convierte la salida del modelo en una plantilla de bloques válida y sin enlaces ajenos. */
export function draftToBody(
  output: DraftOutput,
  sources: readonly CollectedSource[],
  locale: TemplateBody['locale'],
  finder: LinkFinder,
): { body: TemplateBody; removedLinks: string[] } {
  const policy = new LinkPolicy(sources.flatMap((source) => source.urls));
  const documents = new Map(
    sources.flatMap((source) => (source.documentId ? [[source.id, source.documentId]] : [])),
  );
  const removedLinks: string[] = [];
  const clean = (text: string) => {
    const result = sanitizeMarkdownLinks(text, policy, finder);
    removedLinks.push(...result.removed);
    return result.text;
  };
  let counter = 0;
  const nextId = () => `ai${(counter += 1)}`;

  const blocks: EmailBlock[] = [];
  for (const block of output.blocks) {
    if (blocks.length >= MAX_BLOCKS) break;
    switch (block.type) {
      case 'heading': {
        const text = clip(clean(block.text), 200);
        if (text) {
          blocks.push({
            id: nextId(),
            type: 'heading',
            text,
            level: block.level <= 1 ? 1 : 2,
            align: 'left',
          });
        }
        break;
      }
      case 'text': {
        const markdown = clip(clean(block.markdown), 20_000);
        if (markdown) blocks.push({ id: nextId(), type: 'text', markdown });
        break;
      }
      case 'button': {
        const label = clip(clean(block.label), 80);
        if (!policy.allows(block.url)) {
          removedLinks.push(block.url);
          break;
        }
        if (label) {
          blocks.push({
            id: nextId(),
            type: 'button',
            label,
            url: block.url.trim(),
            align: 'center',
          });
        }
        break;
      }
      case 'divider':
        blocks.push({ id: nextId(), type: 'divider' });
        break;
      case 'document': {
        const documentId = documents.get(block.sourceId);
        if (documentId) {
          blocks.push({
            id: nextId(),
            type: 'document',
            documentId,
            title: clip(clean(block.title), 200) || null,
            description: clip(clean(block.description), 300) || null,
            buttonLabel: null,
          });
        }
        break;
      }
    }
  }

  const subject = clip(clean(output.subject), 200);
  const preheader = clip(clean(output.preheader), 200);
  const parsed = templateBodySchema.safeParse({
    format: 'BLOCKS',
    subject,
    preheader,
    locale,
    content: { blocks },
  });
  if (!parsed.success || subject === '' || blocks.length === 0) {
    throw new DomainError('INVALID_STATE', 'La IA no devolvió un correo válido', {
      reason: 'AI_INVALID_OUTPUT',
    });
  }
  return { body: parsed.data, removedLinks };
}

function bodyContext(body: TemplateBody): string {
  return extractTextUnits(body)
    .map((unit) => `${unit.id}: ${unit.text}`)
    .join('\n')
    .slice(0, MAX_CONTEXT_CHARS);
}

export class AiAssistUseCase {
  constructor(private readonly deps: AiAssistDeps) {}

  private async tenantName(context: TenantContext): Promise<string> {
    return (await this.deps.branding.getEmailProfile(context)).name;
  }

  /** Borrador a partir de fuentes (texto, URL, RSS, documentos, novedades). */
  async draftCampaign(context: TenantContext, input: DraftCampaignInput): Promise<DraftResult> {
    assertCan(context, 'ai:use');
    const { sources } = await this.deps.collector.collect(context, input.sources);
    return this.draftFromSources(context, sources, input);
  }

  /** Igual que `draftCampaign` con fuentes ya reunidas (lo usa la automatización). */
  async draftFromSources(
    context: TenantContext,
    sources: readonly CollectedSource[],
    options: { instructions: string; tone: AiTone; locale: TemplateBody['locale'] },
  ): Promise<DraftResult> {
    assertCan(context, 'ai:use');
    if (sources.length === 0) {
      throw new DomainError('VALIDATION', 'Las fuentes no tienen contenido', {
        reason: 'SOURCES_EMPTY',
      });
    }
    const documents = sources
      .filter((source) => source.documentId)
      .map((source) => `${source.id} (${source.title})`);
    const prompt = [
      `Write a customer email in ${languageName(options.locale)}.`,
      `Tone: ${toneGuide(options.tone)}.`,
      'Structure: one level-1 heading, a short introduction, then sections (level-2 headings, short paragraphs or bullet lists) and at most one button.',
      'You may greet with {{ contact.first_name }}. Do not write a footer, signature or unsubscribe text: they are added automatically.',
      documents.length > 0
        ? `Documents you may feature with a document block: ${documents.join(', ')}.`
        : 'There are no documents to feature: do not use document blocks.',
      options.instructions
        ? `Instructions from the editor (trusted):\n<instructions>\n${options.instructions}\n</instructions>`
        : '',
      `Sources:\n${wrapSources(sources)}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const result = await this.deps.ai.generate(context, 'campaign_draft', 'default', {
      system: systemPrompt(await this.tenantName(context), DRAFT_ROLE),
      prompt,
      schema: draftOutputSchema,
      schemaName: 'campaign_draft',
      maxOutputTokens: 16_000,
      effort: 'medium',
    });
    const { body, removedLinks } = draftToBody(
      result.value,
      sources,
      options.locale,
      this.deps.links,
    );
    return {
      body,
      removedLinks,
      sources: summarizeSources(sources),
      costMicros: result.costMicros,
    };
  }

  async suggestSubjects(context: TenantContext, input: z.infer<typeof suggestSubjectsSchema>) {
    assertCan(context, 'ai:use');
    const result = await this.deps.ai.generate(context, 'subject_suggestions', 'fast', {
      system: systemPrompt(await this.tenantName(context), SUBJECTS_ROLE),
      prompt: [
        `Propose 5 subject lines in ${languageName(input.body.locale)} for this email.`,
        'Avoid spam triggers, ALL CAPS and more than one exclamation mark. You may use {{ contact.first_name }}.',
        `<email>\n${bodyContext(input.body)}\n</email>`,
      ].join('\n\n'),
      schema: subjectsOutputSchema,
      schemaName: 'subject_suggestions',
      maxOutputTokens: 4000,
      effort: 'low',
    });
    const allowedTags = new Set([...liquidTags(input.body.subject), '{{ contact.first_name }}']);
    const empty = new LinkPolicy([]);
    const subjects: SubjectSuggestion[] = [];
    for (const suggestion of result.value.subjects.slice(0, 5)) {
      const text = clip(sanitizeMarkdownLinks(suggestion.text, empty, this.deps.links).text, 200);
      if (!text || liquidTags(text).some((tag) => !allowedTags.has(tag))) continue;
      subjects.push({
        text,
        rationale: clip(suggestion.rationale, 300),
        length: text.length,
        flags: analyzeSubject(text),
      });
    }
    return { subjects, costMicros: result.costMicros };
  }

  async translate(
    context: TenantContext,
    input: z.infer<typeof translateSchema>,
  ): Promise<RewriteResult> {
    assertCan(context, 'ai:use');
    if (input.body.locale === input.targetLocale) {
      throw new DomainError('VALIDATION', 'La plantilla ya está en ese idioma', {
        reason: 'AI_SAME_LOCALE',
      });
    }
    return this.rewrite(
      context,
      input.body,
      'translation',
      `Translate every unit from ${languageName(input.body.locale)} to ${languageName(input.targetLocale)}.`,
      input.targetLocale,
    );
  }

  async adjustTone(
    context: TenantContext,
    input: z.infer<typeof adjustToneSchema>,
  ): Promise<RewriteResult> {
    assertCan(context, 'ai:use');
    return this.rewrite(
      context,
      input.body,
      'tone',
      `Rewrite every unit in ${languageName(input.body.locale)} with this tone: ${toneGuide(input.tone)}. Keep the meaning and the facts.`,
    );
  }

  private async rewrite(
    context: TenantContext,
    body: TemplateBody,
    purpose: 'translation' | 'tone',
    task: string,
    targetLocale?: TemplateBody['locale'],
  ): Promise<RewriteResult> {
    const units = extractTextUnits(body);
    const result = await this.deps.ai.generate(
      context,
      purpose,
      purpose === 'tone' ? 'fast' : 'default',
      {
        system: systemPrompt(await this.tenantName(context), REWRITE_ROLE),
        prompt: [
          task,
          'Keep Markdown formatting, Liquid variables ({{ ... }}) and URLs exactly as they are. Return every unit with its original id.',
          `<units>\n${JSON.stringify(units.map(({ id, text }) => ({ id, text })))}\n</units>`,
        ].join('\n\n'),
        schema: textUnitsOutputSchema,
        schemaName: 'text_units',
        maxOutputTokens: 16_000,
        effort: 'low',
      },
    );
    const replacements = new Map(result.value.units.map((unit) => [unit.id, unit.text]));
    return applyTextUnits(
      body,
      replacements,
      this.deps.links,
      targetLocale ? { locale: targetLocale } : {},
    );
  }

  /** Reglas de segmento a partir de una descripción, validadas y con su recuento. */
  async segmentFromText(context: TenantContext, input: z.infer<typeof segmentFromTextSchema>) {
    assertCan(context, 'ai:use');
    assertCan(context, 'segment:write');
    const [fields, lists, tags] = await Promise.all([
      this.deps.fields.list(context),
      this.deps.lists.list(context),
      this.deps.tags.list(context),
    ]);
    const catalog = buildSegmentCatalog(fields);
    const fieldLines = [...catalog.values()]
      .filter((field) => field.kind !== 'list' && field.kind !== 'tag')
      .map((field) => {
        const options = field.options?.length ? ` options: ${field.options.join(' | ')}` : '';
        return `- ${field.id} (${field.kind}; operators: ${OPERATORS_BY_KIND[field.kind].join(', ')}${options})`;
      });
    const today = this.deps.clock.now().toISOString().slice(0, 10);
    const result = await this.deps.ai.generate(context, 'segment', 'default', {
      system: systemPrompt(await this.tenantName(context), SEGMENT_ROLE),
      prompt: [
        `Today is ${today}. Write the explanation in ${languageName(input.locale)}.`,
        `Contact fields:\n${fieldLines.join('\n')}`,
        `- list (operators: inList, notInList; value: one of the list names) lists: ${lists.map((list) => list.name).join(' | ') || 'none'}`,
        `- tag (operators: hasTag, notHasTag; value: one of the tag names) tags: ${tags.map((tag) => tag.name).join(' | ') || 'none'}`,
        'Dates use YYYY-MM-DD. inLastDays/notInLastDays take a number of days.',
        `Audience description (from the editor):\n<description>\n${input.description}\n</description>`,
      ].join('\n\n'),
      schema: segmentOutputSchema,
      schemaName: 'segment_rules',
      maxOutputTokens: 8000,
      effort: 'medium',
    });

    const rules = toRuleSet(result.value, lists, tags);
    try {
      const count = await this.deps.segments.previewCount(context, rules);
      return { rules, explanation: clip(result.value.explanation, 500), count };
    } catch (error) {
      if (isDomainError(error) && error.code === 'VALIDATION') {
        throw new DomainError('VALIDATION', 'La IA propuso reglas no válidas', {
          reason: 'AI_SEGMENT_INVALID',
          detail: error.details?.reason,
        });
      }
      throw error;
    }
  }

  async summarizeResults(context: TenantContext, input: z.infer<typeof summarizeResultsSchema>) {
    assertCan(context, 'ai:use');
    const { campaign, stats, links } = await this.deps.campaigns.report(context, input.campaignId);
    const sent = stats.total - (stats.byStatus.SUPPRESSED ?? 0) - (stats.byStatus.CANCELLED ?? 0);
    const data = {
      campaign: campaign.name,
      recipients: stats.total,
      byStatus: stats.byStatus,
      uniqueOpens: stats.opened,
      automaticOpensExcluded: stats.machineOpens,
      uniqueClicks: stats.clicked,
      downloads: stats.downloads,
      unsubscribed: stats.unsubscribed,
      openRate: sent > 0 ? Number(((stats.opened / sent) * 100).toFixed(1)) : 0,
      clickRate: sent > 0 ? Number(((stats.clicked / sent) * 100).toFixed(1)) : 0,
      abTest: campaign.subjectB ? stats.variants : null,
      topLinks: [...links]
        .sort((a, b) => b.uniqueClicks - a.uniqueClicks)
        .slice(0, 5)
        .map((link) => ({ position: link.position, uniqueClicks: link.uniqueClicks })),
    };
    const result = await this.deps.ai.generate(context, 'results_summary', 'fast', {
      system: systemPrompt(await this.tenantName(context), SUMMARY_ROLE),
      prompt: [
        `Summarize these campaign results in ${languageName(input.locale)}. Industry reference: 20-30% open rate and 2-4% click rate for B2B software newsletters.`,
        `<results>\n${JSON.stringify(data)}\n</results>`,
      ].join('\n\n'),
      schema: summaryOutputSchema,
      schemaName: 'results_summary',
      maxOutputTokens: 4000,
      effort: 'low',
    });
    return sanitizeSummary(result.value, this.deps.links);
  }
}

function sanitizeSummary(summary: SummaryOutput, finder: LinkFinder): SummaryOutput {
  const empty = new LinkPolicy([]);
  const clean = (text: string) => clip(sanitizeMarkdownLinks(text, empty, finder).text, 400);
  return {
    headline: clean(summary.headline),
    highlights: summary.highlights.slice(0, 4).map(clean).filter(Boolean),
    recommendations: summary.recommendations.slice(0, 3).map(clean).filter(Boolean),
  };
}

type Named = { id: string; name: string };

function resolveName(value: unknown, items: readonly Named[]): string | undefined {
  if (typeof value !== 'string') return undefined;
  const needle = value.trim().toLowerCase();
  return items.find((item) => item.id === value || item.name.toLowerCase() === needle)?.id;
}

function toRule(
  condition: SegmentCondition,
  lists: readonly Named[],
  tags: readonly Named[],
): SegmentRule {
  const value = condition.value === null ? undefined : condition.value;
  if (condition.field === 'list') {
    return { field: 'list', operator: condition.operator, value: resolveName(value, lists) };
  }
  if (condition.field === 'tag') {
    return { field: 'tag', operator: condition.operator, value: resolveName(value, tags) };
  }
  return { field: condition.field, operator: condition.operator, value };
}

/** Convierte la salida del modelo (nombres de listas y etiquetas) en reglas con ids. */
export function toRuleSet(
  output: SegmentOutput,
  lists: readonly Named[],
  tags: readonly Named[],
): SegmentRuleSet {
  const ruleSet: SegmentRuleSet = {
    combinator: output.combinator,
    rules: output.rules.map((node) =>
      'rules' in node
        ? {
            combinator: node.combinator,
            rules: node.rules.map((child) => toRule(child, lists, tags)),
          }
        : toRule(node, lists, tags),
    ),
  };
  const parsed = segmentRuleSetSchema.safeParse(ruleSet);
  if (!parsed.success) {
    throw new DomainError('VALIDATION', 'La IA propuso reglas no válidas', {
      reason: 'AI_SEGMENT_INVALID',
    });
  }
  return parsed.data;
}
