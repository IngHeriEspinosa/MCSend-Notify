/** Editor de una plantilla con vista previa e historial de versiones. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getAiPageContext } from '@/app/_server/ai-context';
import { requireTenant } from '@/app/_server/session';
import { LinkButton } from '@/components/molecules/LinkButton';
import { PageHeader } from '@/components/molecules/PageHeader';
import { TemplateEditor } from '@/components/organisms/TemplateEditor';
import { can } from '@/core/identity/permissions';
import { isDomainError } from '@/core/shared/domain-error';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('TemplateEditor');
  return { title: t('title') };
}

export default async function TemplateEditorPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/templates/[templateId]'>) {
  const { tenantSlug, templateId } = await params;
  if (!z.uuid().safeParse(templateId).success) notFound();
  const { tenant, context } = await requireTenant(tenantSlug);
  if (!can(context.actor, 'template:read')) notFound();
  const t = await getTranslations();

  const template = await useCases
    .templates()
    .get(context, templateId)
    .catch((error: unknown) => {
      if (isDomainError(error) && error.code === 'NOT_FOUND') notFound();
      throw error;
    });
  const canReadContacts = can(context.actor, 'contact:read');
  const [versions, documents, fields, contacts, ai] = await Promise.all([
    useCases.templates().versions(context, templateId),
    can(context.actor, 'document:read')
      ? useCases.documents().list(context, { status: 'READY' })
      : Promise.resolve([]),
    canReadContacts ? useCases.contactFields().list(context) : Promise.resolve([]),
    canReadContacts
      ? useCases.listContacts().execute(context, {
          sortField: 'createdAt',
          sortDirection: 'desc',
          page: 0,
          pageSize: 20,
          status: 'ACTIVE',
        })
      : Promise.resolve(null),
    getAiPageContext(context),
  ]);

  return (
    <>
      <PageHeader
        title={template.name}
        subtitle={t('TemplateEditor.subtitle')}
        actions={
          <LinkButton href={`/t/${tenantSlug}/templates`} variant="outlined">
            {t('Common.back')}
          </LinkButton>
        }
      />
      <TemplateEditor
        tenantSlug={tenantSlug}
        template={{
          id: template.id,
          name: template.name,
          description: template.description,
          currentVersion: template.currentVersion,
          body: template.body,
        }}
        versions={versions}
        documents={documents.map((document) => ({
          id: document.id,
          title: document.title,
          kind: document.kind,
        }))}
        fields={fields.map((field) => ({ key: field.key, label: field.label }))}
        contacts={(contacts?.items ?? []).map((contact) => ({
          id: contact.id,
          label:
            [contact.firstName, contact.lastName].filter(Boolean).join(' ') + ` <${contact.email}>`,
        }))}
        canWrite={can(context.actor, 'template:write')}
        timeZone={tenant.timezone}
        aiEnabled={ai.enabled}
      />
    </>
  );
}
