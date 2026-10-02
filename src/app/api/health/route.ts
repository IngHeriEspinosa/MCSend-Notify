/** Liveness: el proceso web responde. No consulta dependencias. */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', uptimeSeconds: Math.round(process.uptime()) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
