import { describe, expect, it } from 'vitest';
import en from './messages/en.json';
import es from './messages/es.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('catálogos de mensajes', () => {
  it('español e inglés tienen exactamente las mismas claves', () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(es).sort());
  });

  it('ningún mensaje está vacío', () => {
    for (const catalog of [es, en]) {
      const values = JSON.stringify(catalog);
      expect(values).not.toMatch(/""/);
    }
  });
});
