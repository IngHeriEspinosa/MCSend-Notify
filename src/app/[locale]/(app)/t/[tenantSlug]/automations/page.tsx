/** Automatizaciones del tenant (p. ej. el resumen semanal de novedades). */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/app/_server/session';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { AutomationsTable } from '@/components/organisms/AutomationsTable';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Automations');
  return { title: t('title') };
}

export default async function AutomationsPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/automations'>) {
  const { tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'automation:read')) notFound();
  const t = await getTranslations('Automations');
  const automations = await useCases.automations().list(context);
  const canWrite = can(context.actor, 'automation:write') && can(context.actor, 'campaign:send');

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canWrite ? (
            <LinkButton href={`/t/${tenantSlug}/automations/new`} variant="contained">
              {t('new')}
            </LinkButton>
          ) : undefined
        }
      />
      <AutomationsTable
        tenantSlug={tenantSlug}
        automations={automations}
        timeZone={tenant.timezone}
      />
    </>
  );
}
