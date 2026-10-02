/** Etiqueta de estado con color semántico (el texto siempre acompaña al color, WCAG 1.4.1). */
import Chip from '@mui/material/Chip';

type Tone = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';

export function StatusChip({ label, tone = 'default' }: { label: string; tone?: Tone }) {
  return (
    <Chip
      size="small"
      label={label}
      color={tone}
      variant={tone === 'default' ? 'outlined' : 'filled'}
    />
  );
}
