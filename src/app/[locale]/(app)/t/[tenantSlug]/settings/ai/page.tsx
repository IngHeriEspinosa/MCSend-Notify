/** Configuración de IA del tenant (solo propietarios y administradores). */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { AiSettingsForm } from '@/components/organisms/AiSettingsForm';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('AiSettings');
  return { title: t('title') };
}

export default async function AiSettingsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/ai'>) {
  const { tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'ai:manage')) notFound();
  const t = await getTranslations('AiSettings');
  const overview = await useCases.aiSettings().overview(context);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <AiSettingsForm
        tenantSlug={tenantSlug}
        settings={overview.settings}
        platformAvailable={overview.platformAvailable}
        platformMaxBudgetUsd={overview.platformMaxBudgetUsd}
        budgetMicros={overview.budgetMicros}
        usage={overview.usage}
        timeZone={tenant.timezone}
      />
    </>
  );
}
