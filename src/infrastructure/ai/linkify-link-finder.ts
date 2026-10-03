/**
 * Detector de enlaces con las mismas reglas que el renderizado de los correos (markdown-it con
 * `linkify` y opciones por defecto): lo que aquí se reconoce como enlace es exactamente lo que el
 * correo convertiría en enlace.
 */
import markdownIt from 'markdown-it';
import type { FoundLink, LinkFinder } from '@/core/ai/guardrails';

export class LinkifyLinkFinder implements LinkFinder {
  private readonly linkify = markdownIt({ linkify: true }).linkify;

  find(text: string): FoundLink[] {
    return (this.linkify.match(text) ?? []).map((match) => ({
      start: match.index,
      end: match.lastIndex,
      url: match.url,
    }));
  }
}
