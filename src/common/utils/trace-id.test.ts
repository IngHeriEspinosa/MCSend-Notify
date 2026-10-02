import { describe, expect, it } from 'vitest';
import { resolveTraceId } from './trace-id';

describe('resolveTraceId', () => {
  it('reutiliza un traceId entrante válido', () => {
    expect(resolveTraceId('invoice:1234-abcd')).toBe('invoice:1234-abcd');
  });

  it.each([null, undefined, '', 'corto', 'con espacios no válidos', '<script>alert(1)</script>'])(
    'genera uno nuevo cuando el entrante es %j',
    (incoming) => {
      const traceId = resolveTraceId(incoming);
      expect(traceId).not.toBe(incoming);
      expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('rechaza valores demasiado largos', () => {
    expect(resolveTraceId('a'.repeat(129))).toHaveLength(36);
  });
});
