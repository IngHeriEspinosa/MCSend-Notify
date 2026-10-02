/**
 * 404 para rutas fuera de un idioma válido. Como el layout raíz es de paso,
 * esta página renderiza su propio documento.
 */
import Link from 'next/link';
import '@/common/global/globals.css';

export default function GlobalNotFound() {
  return (
    <html lang="es">
      <body className="flex min-h-screen items-center justify-center p-6">
        <main className="text-center">
          <h1 className="mb-2 text-2xl font-bold">404</h1>
          <p className="mb-4">Página no encontrada · Page not found</p>
          <Link className="text-primary underline" href="/es">
            Ir al inicio
          </Link>
        </main>
      </body>
    </html>
  );
}
