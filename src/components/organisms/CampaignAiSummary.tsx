'use client';

/** "Resumen con IA" del informe: conclusión, datos clave y recomendaciones (texto plano). */
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { summarizeResultsAction } from '@/app/_server/actions/ai.actions';
import { useAction } from '@/common/hooks/use-action';
import type { SummaryOutput } from '@/core/ai/prompts';

export function CampaignAiSummary({
  tenantSlug,
  campaignId,
}: {
  tenantSlug: string;
  campaignId: string;
}) {
  const t = useTranslations('CampaignAiSummary');
  const locale = useLocale();
  const { run, pending } = useAction();
  const [summary, setSummary] = useState<SummaryOutput | null>(null);

  const generate = () =>
    void run(
      () =>
        summarizeResultsAction(tenantSlug, { campaignId, locale: locale === 'en' ? 'en' : 'es' }),
      { onSuccess: setSummary },
    );

  return (
    <Card variant="outlined" component="section" aria-labelledby="ai-summary-title">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Typography
            id="ai-summary-title"
            variant="h6"
            component="h2"
            className="flex items-center gap-2"
          >
            <AutoAwesomeOutlined color="primary" aria-hidden />
            {t('title')}
          </Typography>
          <Button variant="outlined" onClick={generate} disabled={pending}>
            {pending ? t('generating') : summary ? t('regenerate') : t('generate')}
          </Button>
        </div>
        {summary ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <Typography className="font-medium">{summary.headline}</Typography>
            {summary.highlights.length > 0 ? (
              <div>
                <Typography variant="subtitle2" component="h3">
                  {t('highlights')}
                </Typography>
                <ul className="list-disc pl-5">
                  {summary.highlights.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {summary.recommendations.length > 0 ? (
              <div>
                <Typography variant="subtitle2" component="h3">
                  {t('recommendations')}
                </Typography>
                <ul className="list-disc pl-5">
                  {summary.recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Typography variant="caption" color="text.secondary">
              {t('disclaimer')}
            </Typography>
          </div>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t('hint')}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
