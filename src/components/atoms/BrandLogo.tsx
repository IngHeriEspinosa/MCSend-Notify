/**
 * Logotipo de Multicómputos. Muestra la versión a color en modo claro y la blanca en oscuro,
 * como indica el manual de identidad ("07. Usos apropiados").
 */
import Image from 'next/image';

interface BrandLogoProps {
  alt: string;
  /** Ancho en píxeles; el alto se calcula respetando la proporción del logotipo. */
  width?: number;
  priority?: boolean;
}

const LOGO_ASPECT_RATIO = 127 / 720;

export function BrandLogo({ alt, width = 220, priority = false }: BrandLogoProps) {
  const height = Math.round(width * LOGO_ASPECT_RATIO);

  return (
    <span className="inline-flex">
      <Image
        src="/brand/logo-color.png"
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className="dark:hidden"
      />
      <Image
        src="/brand/logo-white.png"
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        className="hidden dark:block"
      />
    </span>
  );
}
