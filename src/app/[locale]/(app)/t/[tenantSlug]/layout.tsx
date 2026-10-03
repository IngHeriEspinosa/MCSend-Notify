/**
 * Layout de un tenant: resuelve el acceso (404 si no hay membresía) y construye la navegación
 * con los permisos del rol. La navegación solo oculta opciones; cada acción revalida permisos.
 */
import type { Metadata } from 'next';
import { requireTenant } from '@/app/_server/session';
import { AppShell, type NavGroup, type NavItem } from '@/components/organisms/AppShell';
import { can, type Permission } from '@/core/identity/permissions';
import type { Actor } from '@/core/shared/tenant-context';
import { useCases } from '@/infrastructure/use-case-factory';

export async function generateMetadata({
  params,
}: LayoutProps<'/[locale]/t/[tenantSlug]'>): Promise<Metadata> {
  const { tenantSlug } = await params;
  const { tenant } = await requireTenant(tenantSlug);
  return { title: { default: tenant.name, template: `%s · ${tenant.name}` } };
}

function buildNavigation(slug: string, actor: Actor, pendingApprovals: number): NavGroup[] {
  const base = `/t/${slug}`;
  const item = (key: NavItem['key'], path: string, permission: Permission): NavItem[] =>
    can(actor, permission) ? [{ key, href: `${base}/${path}` }] : [];

  return [
    {
      key: 'main' as const,
      items: [
        { key: 'dashboard' as const, href: `${base}/dashboard` },
        ...(can(actor, 'campaign:read')
          ? [{ key: 'approvals' as const, href: `${base}/approvals`, badge: pendingApprovals }]
          : []),
      ],
    },
    {
      key: 'audience' as const,
      items: [
        ...item('contacts', 'contacts', 'contact:read'),
        ...item('lists', 'lists', 'contact:read'),
        ...item('segments', 'segments', 'contact:read'),
        ...item('import', 'contacts/import', 'contact:import'),
      ],
    },
    {
      key: 'content' as const,
      items: [
        ...item('campaigns', 'campaigns', 'campaign:read'),
        ...item('automations', 'automations', 'automation:read'),
        ...item('templates', 'templates', 'template:read'),
        ...item('documents', 'documents', 'document:read'),
        ...item('changelog', 'changelog', 'changelog:read'),
      ],
    },
    {
      key: 'settings' as const,
      items: [
        ...item('general', 'settings/general', 'tenant:read'),
        ...item('branding', 'settings/branding', 'tenant:read'),
        ...item('providers', 'settings/providers', 'provider:manage'),
        ...item('senders', 'settings/senders', 'sender:manage'),
        ...item('ai', 'settings/ai', 'ai:manage'),
        ...item('members', 'settings/members', 'member:read'),
        ...item('fields', 'settings/fields', 'field:manage'),
        ...item('tags', 'settings/tags', 'contact:write'),
        ...item('topics', 'settings/topics', 'topic:manage'),
        ...item('apiKeys', 'settings/api-keys', 'apikey:manage'),
        ...item('activity', 'activity', 'audit:read'),
      ],
    },
  ].filter((group) => group.items.length > 0);
}

export default async function TenantLayout({
  children,
  params,
}: LayoutProps<'/[locale]/t/[tenantSlug]'>) {
  const { tenantSlug } = await params;
  const { user, tenant, context } = await requireTenant(tenantSlug);
  const [tenants, pendingApprovals] = await Promise.all([
    useCases.listUserTenants().execute(user),
    can(context.actor, 'campaign:read') ? useCases.approvals().countPending(context) : 0,
  ]);

  return (
    <AppShell
      tenant={{ slug: tenant.slug, name: tenant.name }}
      tenants={tenants.map((item) => ({ slug: item.tenant.slug, name: item.tenant.name }))}
      user={{
        name: user.name,
        email: user.email,
        isPlatformAdmin: user.platformRole === 'SUPER_ADMIN',
      }}
      navigation={buildNavigation(tenant.slug, context.actor, pendingApprovals)}
    >
      {children}
    </AppShell>
  );
}
