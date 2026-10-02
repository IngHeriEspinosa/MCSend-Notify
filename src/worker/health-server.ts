/**
 * Servidor HTTP mínimo del worker para los healthchecks de Docker y la monitorización.
 * GET /health → 200 si Redis está conectado y todos los workers corren; 503 en otro caso.
 */
import { createServer, type Server } from 'node:http';

export interface WorkerStatus {
  redis: boolean;
  workers: Record<string, boolean>;
}

export function isHealthy(status: WorkerStatus): boolean {
  return status.redis && Object.values(status.workers).every(Boolean);
}

export function startHealthServer(port: number, getStatus: () => WorkerStatus): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    const status = getStatus();
    const healthy = isHealthy(status);
    response
      .writeHead(healthy ? 200 : 503, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      })
      .end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', ...status }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}
