'use client';

/** Notificaciones globales (Snackbar de MUI), accesibles con `role="status"` o `role="alert"`. */
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Severity = 'success' | 'error' | 'info' | 'warning';

interface Notification {
  id: number;
  message: string;
  severity: Severity;
}

type Notify = (message: string, severity?: Severity) => void;

const NotificationsContext = createContext<Notify | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Notification | null>(null);

  const notify = useCallback<Notify>((message, severity = 'success') => {
    setCurrent({ id: Date.now(), message, severity });
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.id}
        open={current !== null}
        autoHideDuration={current?.severity === 'error' ? 8000 : 4000}
        onClose={(_event, reason) => reason !== 'clickaway' && setCurrent(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {current ? (
          <Alert
            severity={current.severity}
            variant="filled"
            onClose={() => setCurrent(null)}
            role={current.severity === 'error' ? 'alert' : 'status'}
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </NotificationsContext.Provider>
  );
}

export function useNotify(): Notify {
  const notify = useContext(NotificationsContext);
  if (!notify) throw new Error('useNotify debe usarse dentro de NotificationsProvider');
  return notify;
}
