/** Utilidades compartidas de las pruebas E2E. */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const ADMIN_STATE = 'tests/e2e/.auth/admin.json';
export const TENANT = process.env.E2E_TENANT ?? 'mcsupport';

/** Argumentos de Chrome: confianza en la CA de pruebas indicada (despliegue con TLS interno). */
export function chromeArgs(): string[] {
  const spki = process.env.E2E_TRUSTED_SPKI;
  return spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : [];
}

/** Reglas WCAG 2.2 A/AA. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * Analiza la página con axe-core y falla si hay incumplimientos graves o críticos; los
 * moderados y menores se devuelven para el informe.
 */
export async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
    })),
    `Incumplimientos WCAG graves en ${label}`,
  ).toEqual([]);
  return results.violations.filter((violation) => !blocking.includes(violation));
}

/** Recoge errores de consola y excepciones no capturadas de la página. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 300)}`);
  });
  return errors;
}
