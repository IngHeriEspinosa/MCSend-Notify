/** Utilidades de presentación de automatizaciones compartidas por Server y Client Components. */
import type { AutomationRunStatus, AutomationSchedule } from '@/core/automations/automation';

export const RUN_STATUS_TONE: Record<
  AutomationRunStatus,
  'default' | 'info' | 'success' | 'warning' | 'error' | 'primary'
> = {
  RUNNING: 'info',
  AWAITING_APPROVAL: 'warning',
  SCHEDULED: 'success',
  SKIPPED: 'default',
  REJECTED: 'default',
  EXPIRED: 'default',
  FAILED: 'error',
};

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Nombre del día de la semana (0 = domingo) en el idioma de la interfaz. */
export function weekdayName(weekday: number, locale: string): string {
  // 2026-10-04 es domingo: sumar días da el nombre de cualquier día de la semana.
  const date = new Date(Date.UTC(2026, 9, 4 + weekday, 12));
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(date);
}

type ScheduleTranslator = (
  key: 'daily' | 'weekly' | 'monthly',
  values: { time: string; weekday?: string; day?: number },
) => string;

/** "Cada lunes a las 09:00", "Cada día a las 08:30", "El día 1 de cada mes a las 07:00". */
export function describeSchedule(
  schedule: AutomationSchedule,
  locale: string,
  translate: ScheduleTranslator,
): string {
  const time = formatTime(schedule.hour, schedule.minute);
  switch (schedule.frequency) {
    case 'daily':
      return translate('daily', { time });
    case 'weekly':
      return translate('weekly', { time, weekday: weekdayName(schedule.weekday, locale) });
    case 'monthly':
      return translate('monthly', { time, day: schedule.dayOfMonth });
  }
}
