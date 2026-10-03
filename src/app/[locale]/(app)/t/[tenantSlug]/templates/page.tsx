/** Plantillas de correo del tenant. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getAiPageContext } from '@/app/_server/ai-context';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { TemplatesTable } from '@/components/organisms/TemplatesTable';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Templates');
  return { title: t('title') };
}

export default async function TemplatesPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/templates'>) {
  const { tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'template:read')) notFound();
  const t = await getTranslations('Templates');
  const [templates, ai] = await Promise.all([
    useCases.templates().list(context),
    getAiPageContext(context),
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <TemplatesTable
        tenantSlug={tenantSlug}
        templates={templates}
        canWrite={can(context.actor, 'template:write')}
        defaultLocale={tenant.defaultLocale === 'en' ? 'en' : 'es'}
        timeZone={tenant.timezone}
        ai={ai}
      />
    </>
  );
}
