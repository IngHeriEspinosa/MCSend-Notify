/** Cualquier ruta desconocida dentro de un idioma muestra el 404 traducido. */
import { notFound } from 'next/navigation';

export default function CatchAllPage() {
  notFound();
}
