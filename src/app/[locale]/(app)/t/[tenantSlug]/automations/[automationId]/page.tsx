/** Detalle de una automatización: control, historial de ejecuciones y edición. */
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { loadAutomationEditorOptions } from '@/app/_server/automation-editor-data';
import { requireTenant } from '@/app/_server/session';
import { describeSchedule } from '@/common/utils/automations-ui';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { AutomationEditor } from '@/components/organisms/AutomationEditor';
import { AutomationRuns } from '@/components/organisms/AutomationRuns';
import { can } from '@/core/identity/permissions';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Automations');
  return { title: t('title') };
}

export default async function AutomationPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/automations/[automationId]'>) {
  const { tenantSlug, automationId } = await params;
  if (!z.uuid().safeParse(automationId).success) notFound();
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'automation:read')) notFound();
  const t = await getTranslations();
  const locale = await getLocale();
  const automation = await useCases
    .automations()
    .get(context, automationId)
    .catch((error: unknown) => {
      if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    });
  const canWrite = can(context.actor, 'automation:write') && can(context.actor, 'campaign:send');
  const [runs, { aiEnabled, ...options }] = await Promise.all([
    useCases.automations().runs(context, automationId),
    loadAutomationEditorOptions(context, locale),
  ]);
  const scheduleText = describeSchedule(automation.schedule, locale, (key, values) =>
    t(`Automations.schedules.${key}`, values),
  );

  return (
    <>
      <PageHeader
        title={automation.name}
        subtitle={`${scheduleText} (${automation.timezone})`}
        actions={
          <LinkButton href={`/t/${tenantSlug}/automations`} variant="outlined">
            {t('Common.back')}
          </LinkButton>
        }
      />
      <div className="flex flex-col gap-8">
        <AutomationRuns
          tenantSlug={tenantSlug}
          automationId={automation.id}
          enabled={automation.enabled}
          scheduleText={t('Automations.nextRuns', { schedule: scheduleText })}
          runs={runs}
          canWrite={canWrite}
          aiEnabled={aiEnabled}
          timeZone={tenant.timezone}
        />
        <AutomationEditor
          tenantSlug={tenantSlug}
          automation={{
            id: automation.id,
            name: automation.name,
            schedule: automation.schedule,
            timezone: automation.timezone,
            definition: automation.definition,
          }}
          defaultTimezone={tenant.timezone}
          defaultLocale={tenant.defaultLocale === 'en' ? 'en' : 'es'}
          canWrite={canWrite}
          {...options}
        />
      </div>
    </>
  );
}
