'use client';

/**
 * Botón de MUI que navega con el Link de next-intl (respeta el idioma de la ruta).
 * Permite usar enlaces con estilo de botón desde Server Components, que no pueden pasar
 * componentes (funciones) a la prop `component` de un componente cliente.
 */
import Button, { type ButtonProps } from '@mui/material/Button';
import CardActionArea from '@mui/material/CardActionArea';
import type { ReactNode } from 'react';
import { Link } from '@/common/i18n/navigation';

interface LinkButtonProps {
  href: string;
  children: ReactNode;
  variant?: ButtonProps['variant'];
  color?: ButtonProps['color'];
  size?: ButtonProps['size'];
  startIcon?: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function LinkButton({ href, disabled, children, ...style }: LinkButtonProps) {
  if (disabled) {
    return (
      <Button {...style} disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button {...style} component={Link} href={href}>
      {children}
    </Button>
  );
}

/** Área clicable de una tarjeta que navega a `href`. */
export function LinkCardArea({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <CardActionArea component={Link} href={href} className={className}>
      {children}
    </CardActionArea>
  );
}
