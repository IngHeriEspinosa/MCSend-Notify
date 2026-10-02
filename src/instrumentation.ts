/**
 * Instrumentación de Next.js: valida el entorno al arrancar el servidor (falla pronto)
 * y registra los errores de petición en el logger, que los reenvía a MCLog si está configurado.
 */
import type { Instrumentation } from 'next';
import { TRACE_ID_HEADER } from '@/common/utils/trace-id';

const isBuildPhase = () => process.env.NEXT_PHASE === 'phase-production-build';
const CLIENT_ABORT_MESSAGE = 'The destination stream closed early.';

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || isBuildPhase()) {
    return;
  }
  const { getServerEnv } = await import('@/common/config/env');
  getServerEnv();
  const { getLogger } = await import('@/infrastructure/container');
  getLogger().info('Servidor web iniciado');
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { getLogger } = await import('@/infrastructure/container');
  const traceHeader = request.headers[TRACE_ID_HEADER];
  const logger = getLogger();
  // El cliente cerró la conexión (navegación cancelada o prefetch abortado): no es un fallo del servidor.
  const clientAborted = error instanceof Error && error.message === CLIENT_ABORT_MESSAGE;
  (clientAborted ? logger.debug.bind(logger) : logger.error.bind(logger))(
    {
      err: error,
      method: request.method,
      path: request.path,
      routePath: context.routePath,
      routeType: context.routeType,
      traceId: Array.isArray(traceHeader) ? traceHeader[0] : traceHeader,
    },
    'Error al procesar la petición',
  );
};
