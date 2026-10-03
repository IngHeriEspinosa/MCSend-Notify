/** Alta de una automatización. */
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { loadAutomationEditorOptions } from '@/app/_server/automation-editor-data';
import { requireTenant } from '@/app/_server/session';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { AutomationEditor } from '@/components/organisms/AutomationEditor';
import { can } from '@/core/identity/permissions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Automations');
  return { title: t('new') };
}

export default async function NewAutomationPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/automations/new'>) {
  const { tenantSlug } = await params;
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'automation:write') || !can(context.actor, 'campaign:send')) notFound();
  const t = await getTranslations();
  const { aiEnabled: _ai, ...options } = await loadAutomationEditorOptions(
    context,
    await getLocale(),
  );

  return (
    <>
      <PageHeader
        title={t('Automations.new')}
        subtitle={t('Automations.newSubtitle')}
        actions={
          <LinkButton href={`/t/${tenantSlug}/automations`} variant="outlined">
            {t('Common.back')}
          </LinkButton>
        }
      />
      <AutomationEditor
        tenantSlug={tenantSlug}
        defaultTimezone={tenant.timezone}
        defaultLocale={tenant.defaultLocale === 'en' ? 'en' : 'es'}
        canWrite
        {...options}
      />
    </>
  );
}
