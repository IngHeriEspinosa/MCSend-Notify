/**
 * Unidades de texto de una plantilla para traducirla o ajustar su tono con IA.
 *
 * El modelo solo ve y devuelve textos con un id; la estructura (bloques, URL de botones e
 * imágenes, documentos) nunca pasa por la IA. Cada texto devuelto se valida antes de aplicarse:
 * longitud máxima, mismas variables Liquid y ningún enlace que no estuviera en el original.
 * Si una unidad no pasa la validación se conserva el texto original y se informa.
 */
import { DomainError } from '@/core/shared/domain-error';
import {
  templateBodySchema,
  type ColumnBlock,
  type EmailBlock,
  type TemplateBody,
} from '@/core/templates/email-content';
import {
  extractUrls,
  hasSameLiquidTags,
  LinkPolicy,
  sanitizeMarkdownLinks,
  type LinkFinder,
} from './guardrails';

export interface TextUnit {
  id: string;
  text: string;
  maxLength: number;
}

type Visitor = (unit: TextUnit, set: (text: string) => void) => void;

function visitColumn(block: ColumnBlock, path: string, visit: Visitor): void {
  switch (block.type) {
    case 'heading':
      visit({ id: `${path}.text`, text: block.text, maxLength: 200 }, (text) => {
        block.text = text;
      });
      return;
    case 'text':
      visit({ id: `${path}.markdown`, text: block.markdown, maxLength: 20_000 }, (text) => {
        block.markdown = text;
      });
      return;
    case 'button':
      visit({ id: `${path}.label`, text: block.label, maxLength: 80 }, (text) => {
        block.label = text;
      });
      return;
    case 'image':
      visit({ id: `${path}.alt`, text: block.alt, maxLength: 200 }, (text) => {
        block.alt = text;
      });
      return;
  }
}

function visitBlock(block: EmailBlock, path: string, visit: Visitor): void {
  switch (block.type) {
    case 'heading':
    case 'text':
    case 'button':
    case 'image':
      visitColumn(block, path, visit);
      return;
    case 'document':
      if (block.title) {
        visit({ id: `${path}.title`, text: block.title, maxLength: 200 }, (text) => {
          block.title = text;
        });
      }
      if (block.description) {
        visit({ id: `${path}.description`, text: block.description, maxLength: 300 }, (text) => {
          block.description = text;
        });
      }
      if (block.buttonLabel) {
        visit({ id: `${path}.buttonLabel`, text: block.buttonLabel, maxLength: 60 }, (text) => {
          block.buttonLabel = text;
        });
      }
      return;
    case 'columns':
      block.left.forEach((child, index) => visitColumn(child, `${path}.l${index}`, visit));
      block.right.forEach((child, index) => visitColumn(child, `${path}.r${index}`, visit));
      return;
    case 'divider':
    case 'spacer':
      return;
  }
}

function walk(body: TemplateBody, visit: Visitor): void {
  visit({ id: 'subject', text: body.subject, maxLength: 200 }, (text) => {
    body.subject = text;
  });
  if (body.preheader) {
    visit({ id: 'preheader', text: body.preheader, maxLength: 200 }, (text) => {
      body.preheader = text;
    });
  }
  switch (body.format) {
    case 'BLOCKS':
      body.content.blocks.forEach((block, index) => visitBlock(block, `b${index}`, visit));
      return;
    case 'MARKDOWN':
      visit({ id: 'markdown', text: body.content.markdown, maxLength: 50_000 }, (text) => {
        body.content.markdown = text;
      });
      return;
    case 'HTML':
      throw new DomainError('VALIDATION', 'La IA no reescribe plantillas HTML', {
        reason: 'AI_UNSUPPORTED_FORMAT',
      });
  }
}

/** Textos editables de la plantilla (sin URL ni estructura). Las unidades vacías se omiten. */
export function extractTextUnits(body: TemplateBody): TextUnit[] {
  const units: TextUnit[] = [];
  walk(structuredClone(body), (unit) => {
    if (unit.text.trim() !== '') units.push(unit);
  });
  return units;
}

export interface AppliedTextUnits {
  body: TemplateBody;
  /** Ids de las unidades que conservaron el texto original por no superar la validación. */
  rejected: string[];
  removedLinks: string[];
}

/** Aplica los textos devueltos por la IA tras validarlos uno a uno. */
export function applyTextUnits(
  body: TemplateBody,
  replacements: ReadonlyMap<string, string>,
  finder: LinkFinder,
  overrides: { locale?: TemplateBody['locale'] } = {},
): AppliedTextUnits {
  const clone = structuredClone(body);
  const rejected: string[] = [];
  const removedLinks: string[] = [];

  walk(clone, (unit, set) => {
    const candidate = replacements.get(unit.id)?.trim();
    if (candidate === undefined || unit.text.trim() === '') return;
    const policy = new LinkPolicy([
      ...extractUrls(unit.text),
      ...finder.find(unit.text).map((link) => link.url),
    ]);
    const sanitized = sanitizeMarkdownLinks(candidate, policy, finder);
    const text = sanitized.text.trim();
    if (text === '' || text.length > unit.maxLength || !hasSameLiquidTags(unit.text, text)) {
      rejected.push(unit.id);
      return;
    }
    removedLinks.push(...sanitized.removed);
    set(text);
  });

  if (overrides.locale) clone.locale = overrides.locale;
  const parsed = templateBodySchema.safeParse(clone);
  if (!parsed.success) {
    throw new DomainError('INVALID_STATE', 'El resultado de la IA no es una plantilla válida', {
      reason: 'AI_INVALID_OUTPUT',
    });
  }
  return { body: parsed.data, rejected, removedLinks };
}
