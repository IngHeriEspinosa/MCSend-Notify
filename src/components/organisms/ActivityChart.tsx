'use client';

/**
 * Actividad de envío por día (enviados, aperturas y clics). La gráfica va acompañada de una tabla
 * con los mismos datos para lectores de pantalla (WCAG 1.1.1).
 */
import Typography from '@mui/material/Typography';
import { BarChart } from '@mui/x-charts/BarChart';
import { useLocale, useTranslations } from 'next-intl';
import type { DailyActivity } from '@/core/campaigns/delivery';

export function ActivityChart({ data }: { data: DailyActivity[] }) {
  const t = useTranslations('Dashboard');
  const locale = useLocale();
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const labels = data.map((item) => day.format(new Date(`${item.day}T00:00:00Z`)));

  if (data.length === 0) {
    return (
      <Typography
        color="text.secondary"
        className="rounded-lg border border-dashed border-line px-6 py-10 text-center"
      >
        {t('noActivity')}
      </Typography>
    );
  }

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div aria-hidden="true">
        <BarChart
          height={280}
          xAxis={[{ scaleType: 'band', data: labels }]}
          series={[
            { data: data.map((item) => item.sent), label: t('sent') },
            { data: data.map((item) => item.opened), label: t('opened') },
            { data: data.map((item) => item.clicked), label: t('clicked') },
          ]}
        />
      </div>
      <figcaption className="sr-only">
        <table>
          <caption>{t('activityTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('day')}</th>
              <th scope="col">{t('sent')}</th>
              <th scope="col">{t('opened')}</th>
              <th scope="col">{t('clicked')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item, index) => (
              <tr key={item.day}>
                <th scope="row">{labels[index]}</th>
                <td>{item.sent}</td>
                <td>{item.opened}</td>
                <td>{item.clicked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
