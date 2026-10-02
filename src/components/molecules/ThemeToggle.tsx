'use client';

/** Alterna entre modo claro y oscuro. El modo inicial sigue la preferencia del sistema. */
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useColorScheme } from '@mui/material/styles';
import { useTranslations } from 'next-intl';

export function ThemeToggle() {
  const t = useTranslations('Common');
  const { mode, systemMode, setMode } = useColorScheme();
  const resolvedMode = mode === 'system' ? systemMode : mode;

  // Antes de hidratar no se conoce el modo: se reserva el espacio sin cambiar el marcado.
  if (!resolvedMode) {
    return <IconButton aria-label={t('toggleTheme')} disabled size="large" />;
  }

  const nextMode = resolvedMode === 'dark' ? 'light' : 'dark';

  return (
    <Tooltip title={nextMode === 'dark' ? t('themeDark') : t('themeLight')}>
      <IconButton
        aria-label={t('toggleTheme')}
        onClick={() => setMode(nextMode)}
        size="large"
        color="inherit"
      >
        {resolvedMode === 'dark' ? <LightModeOutlined /> : <DarkModeOutlined />}
      </IconButton>
    </Tooltip>
  );
}
