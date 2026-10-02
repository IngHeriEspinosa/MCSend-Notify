'use client';

/**
 * Vista previa aislada de un correo: <iframe sandbox="" srcDoc>. Sin `allow-scripts` ni
 * `allow-same-origin`, el HTML no puede ejecutar código ni acceder a la sesión de la app.
 */
import { useTranslations } from 'next-intl';

interface EmailPreviewFrameProps {
  html: string;
  device: 'desktop' | 'mobile';
  dark: boolean;
  busy?: boolean;
}

export function EmailPreviewFrame({ html, device, dark, busy = false }: EmailPreviewFrameProps) {
  const t = useTranslations('TemplateEditor');
  return (
    <div
      className={`flex justify-center overflow-hidden rounded-lg border border-line p-2 transition-opacity ${
        dark ? 'bg-neutral-900' : 'bg-neutral-100'
      } ${busy ? 'opacity-60' : 'opacity-100'}`}
      aria-busy={busy}
    >
      <iframe
        title={t('previewFrameTitle')}
        sandbox=""
        srcDoc={html}
        referrerPolicy="no-referrer"
        className={`h-[720px] w-full border-0 bg-white ${device === 'mobile' ? 'max-w-[375px]' : 'max-w-[640px]'}`}
      />
    </div>
  );
}
