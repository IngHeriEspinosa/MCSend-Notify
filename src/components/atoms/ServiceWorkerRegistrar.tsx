'use client';

/** Registra el service worker de la PWA (solo en producción: en desarrollo interferiría con HMR). */
import { useEffect } from 'react';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Sin service worker la app funciona igual (solo pierde la página sin conexión).
    });
  }, []);
  return null;
}
