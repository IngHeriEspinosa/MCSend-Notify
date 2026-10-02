import { describe, expect, it } from 'vitest';
import { TrackingEmailInstrumenter } from './email-instrumenter';

const instrumenter = new TrackingEmailInstrumenter();
const html = `<html><body>
<a href="https://multicomputos.com/a?x=1&amp;y=2">A</a>
<a href="https://multicomputos.com/b">B</a>
<a href="https://multicomputos.com/a?x=1&amp;y=2">A otra vez</a>
<a href="mailto:soporte@multicomputos.com">correo</a>
<a href="{{ unsubscribe_url }}">baja</a>
<a href="https://site.test/?email={{ contact.email }}">personal</a>
</body></html>`;

describe('TrackingEmailInstrumenter', () => {
  it('sustituye los enlaces fijos por variables de seguimiento y deduplica las URL', () => {
    const result = instrumenter.instrument(html, { trackOpens: false, trackClicks: true });
    expect(result.links).toEqual([
      'https://multicomputos.com/a?x=1&y=2',
      'https://multicomputos.com/b',
    ]);
    expect(result.html.match(/tracking\.links\.l0/g)).toHaveLength(2);
    expect(result.html).toContain('href="{{ tracking.links.l1 }}"');
  });

  it('no rastrea mailto, enlaces de baja ni URL personalizadas con variables', () => {
    const result = instrumenter.instrument(html, { trackOpens: false, trackClicks: true });
    expect(result.html).toContain('href="mailto:soporte@multicomputos.com"');
    expect(result.html).toContain('href="{{ unsubscribe_url }}"');
    expect(result.html).toContain('href="https://site.test/?email={{ contact.email }}"');
  });

  it('inserta el píxel de apertura antes de </body> y respeta las opciones desactivadas', () => {
    const tracked = instrumenter.instrument(html, { trackOpens: true, trackClicks: false });
    expect(tracked.html).toMatch(/<img src="\{\{ tracking\.open_url \}\}"[^>]*>\n<\/body>/);
    expect(tracked.links).toEqual([]);
    expect(instrumenter.instrument(html, { trackOpens: false, trackClicks: false }).html).toBe(
      html,
    );
  });
});
