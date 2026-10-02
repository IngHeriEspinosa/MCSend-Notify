/**
 * Readiness: estado de las dependencias. Devuelve 503 si cae una dependencia crítica.
 * El detalle de los fallos solo se registra en los logs, nunca en la respuesta.
 */
import { getLogger, getReadinessChecks } from '@/infrastructure/container';
import { runHealthChecks } from '@/infrastructure/observability/readiness';

export const dynamic = 'force-dynamic';

export async function GET() {
  const logger = getLogger();
  const report = await runHealthChecks(getReadinessChecks(), {
    onFailure: (check, error) =>
      logger.warn({ err: error, check }, 'Comprobación de salud fallida'),
  });

  return Response.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
