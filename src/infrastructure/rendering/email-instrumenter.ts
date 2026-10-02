/**
 * Instrumenta el HTML compilado de una campaña:
 * - Sustituye cada enlace http(s) fijo por `{{ tracking.links.lN }}` y devuelve la lista de URL
 *   (la posición N identifica el CampaignLink). Los enlaces que contienen variables Liquid
 *   (personalizados) y los de baja/preferencias no se rastrean.
 * - Inserta el píxel de apertura `{{ tracking.open_url }}` antes de `</body>`.
 * Las variables se resuelven por destinatario al personalizar.
 */
import type { EmailInstrumenter } from '@/core/campaigns/ports';
import { decodeEntities } from './html';

const HREF = /href="(https?:\/\/[^"]+)"/gi;

export class TrackingEmailInstrumenter implements EmailInstrumenter {
  instrument(html: string, options: { trackOpens: boolean; trackClicks: boolean }) {
    const links: string[] = [];
    let output = html;
    if (options.trackClicks) {
      const positions = new Map<string, number>();
      output = output.replace(HREF, (match, rawUrl: string) => {
        if (rawUrl.includes('{{') || rawUrl.includes('{%')) return match;
        const url = decodeEntities(rawUrl);
        let position = positions.get(url);
        if (position === undefined) {
          position = links.length;
          links.push(url);
          positions.set(url, position);
        }
        return `href="{{ tracking.links.l${position} }}"`;
      });
    }
    if (options.trackOpens) {
      const pixel =
        '<img src="{{ tracking.open_url }}" width="1" height="1" alt="" style="display: block; width: 1px; height: 1px; border: 0;">';
      output = output.includes('</body>')
        ? output.replace('</body>', `${pixel}\n</body>`)
        : `${output}${pixel}`;
    }
    return { html: output, links };
  }
}
