/**
 * Motor de variables Liquid en modo restringido (OWASP A03, inyección de plantillas):
 * - Sin acceso a archivos: `include`/`render` solo ven un mapa vacío en memoria.
 * - Solo propiedades propias de los objetos (nada de `constructor`, `__proto__`...).
 * - Filtros estrictos y sin el filtro `raw`, que desactivaría el escape HTML.
 * - Límites de tamaño de plantilla, tiempo de render y memoria.
 * - En el cuerpo HTML toda salida `{{ }}` se escapa; en asunto y texto plano no.
 */
import { Liquid, type LiquidOptions } from 'liquidjs';

const BASE_OPTIONS: LiquidOptions = {
  templates: {},
  strictFilters: true,
  strictVariables: false,
  ownPropertyOnly: true,
  parseLimit: 300_000,
  renderLimit: 2_000,
  memoryLimit: 16 * 1024 * 1024,
  cache: 500,
};

export type LiquidOutputMode = 'html' | 'text';

export type LiquidAnalysis = { ok: true; variables: string[] } | { ok: false; message: string };

function createEngine(mode: LiquidOutputMode): Liquid {
  const engine = new Liquid({
    ...BASE_OPTIONS,
    ...(mode === 'html' ? { outputEscape: 'escape' as const } : {}),
  });
  engine.unregisterFilter('raw');
  return engine;
}

export class LiquidEngine {
  private readonly engines: Record<LiquidOutputMode, Liquid> = {
    html: createEngine('html'),
    text: createEngine('text'),
  };

  /** Variables globales usadas (con su ruta, p. ej. `contact.first_name`) o el error de sintaxis. */
  analyze(source: string): LiquidAnalysis {
    try {
      const variables = this.engines.text.globalFullVariablesSync(source);
      return { ok: true, variables: [...new Set(variables)] };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  render(source: string, variables: object, mode: LiquidOutputMode): Promise<string> {
    return this.engines[mode].parseAndRender(source, variables);
  }
}

const LIQUID_TAG = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g;
const PLACEHOLDER = /MCLQ(\d+)QLMC/g;

/**
 * Protege las etiquetas Liquid mientras el contenido pasa por Markdown, el saneador y el
 * inliner de CSS, que escaparían sus comillas. Se sustituyen por marcadores alfanuméricos y se
 * restauran al final. `tagAt` permite validar el enlace original de un marcador.
 */
export class LiquidProtector {
  private readonly tags: string[] = [];

  protect(source: string): string {
    return source.replace(LIQUID_TAG, (tag) => {
      this.tags.push(tag);
      return `MCLQ${this.tags.length - 1}QLMC`;
    });
  }

  /** Etiqueta original si `value` es exactamente un marcador. */
  tagAt(value: string): string | null {
    const match = /^MCLQ(\d+)QLMC$/.exec(value.trim());
    return match?.[1] !== undefined ? (this.tags[Number(match[1])] ?? null) : null;
  }

  restore(output: string): string {
    return output.replace(
      PLACEHOLDER,
      (marker, index: string) => this.tags[Number(index)] ?? marker,
    );
  }
}
