'use client';

/** Aviso persistente mientras el navegador no tiene conexión (anunciado a lectores de pantalla). */
import Alert from '@mui/material/Alert';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const t = useTranslations('Pwa');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-[1400] p-3" role="status">
      <Alert severity="warning" variant="filled" className="mx-auto max-w-xl">
        {t('offlineBanner')}
      </Alert>
    </div>
  );
}
