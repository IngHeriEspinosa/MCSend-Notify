import { describe, expect, it } from 'vitest';
import { canTransition, variantFor } from './campaign';
import { isLinkScanner, isMachineOpen, maskEmail } from './delivery';

describe('estados de campaña', () => {
  it('permite solo las transiciones del ciclo de vida', () => {
    expect(canTransition('DRAFT', 'SCHEDULED')).toBe(true);
    expect(canTransition('SCHEDULED', 'DRAFT')).toBe(true);
    expect(canTransition('SENDING', 'PAUSED')).toBe(true);
    expect(canTransition('PAUSED', 'SENDING')).toBe(true);
    expect(canTransition('SENT', 'SENDING')).toBe(false);
    expect(canTransition('DRAFT', 'SENDING')).toBe(false);
    expect(canTransition('CANCELLED', 'SCHEDULED')).toBe(false);
  });
});

describe('variante A/B', () => {
  it('es estable por contacto y reparte aproximadamente 50/50', () => {
    const ids = Array.from({ length: 2000 }, () => crypto.randomUUID());
    expect(variantFor(ids[0] ?? '')).toBe(variantFor(ids[0] ?? ''));
    const share = ids.filter((id) => variantFor(id) === 'A').length / ids.length;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
  });
});

describe('detección de interacción automática', () => {
  it('reconoce aperturas automáticas (Apple Mail Privacy Protection)', () => {
    expect(isMachineOpen('Mozilla/5.0')).toBe(true);
    expect(isMachineOpen(undefined)).toBe(true);
    expect(
      isMachineOpen('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe(false);
  });

  it('reconoce escáneres de enlaces y peticiones HEAD', () => {
    expect(isLinkScanner('Microsoft Office Safe Links', 'GET')).toBe(true);
    expect(isLinkScanner('Mozilla/5.0 Chrome/140', 'HEAD')).toBe(true);
    expect(isLinkScanner('Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537.36', 'GET')).toBe(
      false,
    );
  });

  it('enmascara el email en páginas públicas', () => {
    expect(maskEmail('ana.perez@cliente.com')).toBe('a***@cliente.com');
  });
});
