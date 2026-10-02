import { describe, expect, it } from 'vitest';
import { ensureUtf8Charset } from './gotenberg-converter';

describe('ensureUtf8Charset', () => {
  it('declara UTF-8 tras el doctype si el HTML no lo declara', () => {
    expect(ensureUtf8Charset('<!doctype html><p>Boletín</p>')).toBe(
      '<!doctype html><meta charset="utf-8"><p>Boletín</p>',
    );
    expect(ensureUtf8Charset('<p>Hola</p>')).toBe('<meta charset="utf-8"><p>Hola</p>');
  });

  it('respeta una declaración existente', () => {
    const html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">';
    expect(ensureUtf8Charset(html)).toBe(html);
  });
});
