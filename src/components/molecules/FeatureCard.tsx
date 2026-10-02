/** Tarjeta de característica: icono, título y descripción. */
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
}

export function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <Card variant="outlined" className="h-full">
      <CardContent className="flex flex-col gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-11 items-center justify-center rounded-lg bg-secondary text-secondary-contrast"
        >
          {icon}
        </span>
        <Typography variant="h6" component="h3">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </CardContent>
    </Card>
  );
}
