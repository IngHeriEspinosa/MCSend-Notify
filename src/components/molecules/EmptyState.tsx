/** Estado vacío de una lista o tabla. */
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <Typography color="text.secondary">{message}</Typography>
      {action}
    </div>
  );
}
