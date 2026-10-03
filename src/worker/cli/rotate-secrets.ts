/**
 * Recifra los secretos en reposo con la clave activa.
 *
 *   pnpm secrets:rotate            → simulación: informa de cuántas filas usan claves antiguas
 *   pnpm secrets:rotate --apply    → recifra
 *
 * En Docker: `docker compose run --rm worker node dist/worker/rotate-secrets.mjs --apply`.
 * Procedimiento completo en docs/adr/0010-secrets-encryption.md.
 * Autor: Ing. Heri Espinosa
 */
import { getPrisma, getSecretCipher, shutdownContainer } from '@/infrastructure/container';
import { rotateSecrets } from '@/infrastructure/crypto/secret-rotation';

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  const reports = await rotateSecrets(getPrisma(), getSecretCipher(), { dryRun: !apply });
  const lines = [apply ? 'Rotación aplicada:' : 'Simulación (usa --apply para recifrar):'];
  for (const report of reports) {
    lines.push(
      `  ${report.table}: ${report.scanned} revisadas, ${report.rotated} ${apply ? 'recifradas' : 'por recifrar'}, ${report.failed.length} ilegibles`,
      ...report.failed.map((id) => `    ilegible: ${id}`),
    );
  }
  process.stdout.write(`${lines.join('\n')}\n`);
  // Las ilegibles necesitan atención manual (volver a introducir la credencial).
  return reports.some((report) => report.failed.length > 0) ? 2 : 0;
}

main()
  .then(async (code) => {
    await shutdownContainer();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error('No se pudo completar la rotación:', error);
    await shutdownContainer();
    process.exit(1);
  });
