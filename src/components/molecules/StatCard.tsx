/** Tarjeta de métrica para el panel de inicio. */
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

interface StatCardProps {
  label: string;
  value: number;
  locale: string;
}

export function StatCard({ label, value, locale }: StatCardProps) {
  return (
    <Card variant="outlined" className="h-full">
      <CardContent className="flex flex-col gap-1">
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h4" component="p">
          {new Intl.NumberFormat(locale).format(value)}
        </Typography>
      </CardContent>
    </Card>
  );
}
