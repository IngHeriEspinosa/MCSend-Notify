/**
 * Estado de carga de las páginas del tenant. Además de mostrar un esqueleto mientras se
 * consulta la base de datos, delimita el prefetch de Next.js: los enlaces del menú solo
 * precargan hasta aquí y no renderizan cada página dinámica completa.
 */
import Skeleton from '@mui/material/Skeleton';

export default function TenantLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <Skeleton variant="text" className="h-12 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} variant="rounded" className="h-28" />
        ))}
      </div>
      <Skeleton variant="rounded" className="h-80" />
    </div>
  );
}
