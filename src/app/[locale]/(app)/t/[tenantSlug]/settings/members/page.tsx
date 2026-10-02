/** Miembros del tenant e invitaciones pendientes. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireTenant } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { MembersManager } from '@/components/organisms/MembersManager';
import { can } from '@/core/identity/permissions';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Settings');
  return { title: t('membersTitle') };
}

export default async function MembersPage({
  params,
}: PageProps<'/[locale]/t/[tenantSlug]/settings/members'>) {
  const { tenantSlug } = await params;
  const { user, context } = await requireTenant(tenantSlug);
  const t = await getTranslations('Settings');
  const { members, pendingInvitations } = await useCases.listMembers().execute(context);
  const actorRole = context.actor.type === 'user' ? context.actor.role : 'VIEWER';

  return (
    <>
      <PageHeader title={t('membersTitle')} subtitle={t('membersSubtitle')} />
      <MembersManager
        tenantSlug={tenantSlug}
        currentUserId={user.id}
        actorRole={actorRole}
        canManage={can(context.actor, 'member:manage')}
        members={members.map(({ id, userId, email, name, role }) => ({
          id,
          userId,
          email,
          name,
          role,
        }))}
        invitations={pendingInvitations.map(({ id, email, role, expiresAt }) => ({
          id,
          email,
          role,
          expiresAt,
        }))}
      />
    </>
  );
}
