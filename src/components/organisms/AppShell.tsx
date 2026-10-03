'use client';

/**
 * Estructura de la aplicación autenticada: barra superior, navegación lateral (fija en escritorio,
 * desplegable en móvil), selector de aplicación (tenant) y menú de usuario.
 * La navegación llega ya filtrada por permisos desde el servidor.
 */
import AlternateEmailOutlined from '@mui/icons-material/AlternateEmailOutlined';
import AppsOutlined from '@mui/icons-material/AppsOutlined';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import BrushOutlined from '@mui/icons-material/BrushOutlined';
import ContactsOutlined from '@mui/icons-material/ContactsOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import FilterAltOutlined from '@mui/icons-material/FilterAltOutlined';
import GroupOutlined from '@mui/icons-material/GroupOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import LabelOutlined from '@mui/icons-material/LabelOutlined';
import ListAltOutlined from '@mui/icons-material/ListAltOutlined';
import MailOutlined from '@mui/icons-material/MailOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import NewReleasesOutlined from '@mui/icons-material/NewReleasesOutlined';
import NotificationsActiveOutlined from '@mui/icons-material/NotificationsActiveOutlined';
import ScheduleSendOutlined from '@mui/icons-material/ScheduleSendOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';
import { logout } from '@/app/_server/auth-actions';
import { Link, usePathname } from '@/common/i18n/navigation';
import { BrandLogo } from '@/components/atoms/BrandLogo';
import { LocaleSwitcher } from '@/components/molecules/LocaleSwitcher';
import { ThemeToggle } from '@/components/molecules/ThemeToggle';

export type NavIcon =
  | 'dashboard'
  | 'approvals'
  | 'contacts'
  | 'lists'
  | 'segments'
  | 'import'
  | 'campaigns'
  | 'automations'
  | 'changelog'
  | 'templates'
  | 'documents'
  | 'general'
  | 'branding'
  | 'providers'
  | 'senders'
  | 'ai'
  | 'members'
  | 'fields'
  | 'tags'
  | 'topics'
  | 'apiKeys'
  | 'activity';

const ICONS: Record<NavIcon, ReactElement> = {
  dashboard: <DashboardOutlined />,
  approvals: <FactCheckOutlined />,
  contacts: <ContactsOutlined />,
  lists: <ListAltOutlined />,
  segments: <FilterAltOutlined />,
  import: <UploadFileOutlined />,
  campaigns: <SendOutlined />,
  automations: <ScheduleSendOutlined />,
  changelog: <NewReleasesOutlined />,
  templates: <MailOutlined />,
  documents: <ArticleOutlined />,
  general: <SettingsOutlined />,
  branding: <BrushOutlined />,
  providers: <HubOutlined />,
  senders: <AlternateEmailOutlined />,
  ai: <AutoAwesomeOutlined />,
  members: <GroupOutlined />,
  fields: <TuneOutlined />,
  tags: <LabelOutlined />,
  topics: <NotificationsActiveOutlined />,
  apiKeys: <KeyOutlined />,
  activity: <HistoryOutlined />,
};

export interface NavItem {
  key: NavIcon;
  href: string;
  /** Contador visible junto a la opción (p. ej. aprobaciones pendientes). */
  badge?: number;
}

export interface NavGroup {
  key: 'main' | 'audience' | 'content' | 'settings';
  items: NavItem[];
}

interface AppShellProps {
  tenant: { slug: string; name: string };
  tenants: Array<{ slug: string; name: string }>;
  user: { name: string | null; email: string; isPlatformAdmin: boolean };
  navigation: NavGroup[];
  children: ReactNode;
}

function initials(user: { name: string | null; email: string }): string {
  const source = user.name?.trim() || user.email;
  return source
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function AppShell({ tenant, tenants, user, navigation, children }: AppShellProps) {
  const t = useTranslations();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tenantMenu, setTenantMenu] = useState<HTMLElement | null>(null);
  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null);

  // Solo se marca la ruta más específica (p. ej. "Importar" y no también "Contactos").
  const activeHref = navigation
    .flatMap((group) => group.items.map((item) => item.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  const drawerContent = (
    <nav aria-label={t('Shell.mainNavigation')} className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <BrandLogo alt={t('Common.brandAlt')} width={170} />
      </div>
      <Divider />
      <div className="flex-1 overflow-y-auto py-2">
        {navigation.map((group) => (
          <List
            key={group.key}
            dense
            subheader={
              group.key === 'main' ? undefined : (
                <ListSubheader component="div" disableSticky>
                  {t(`Nav.${group.key}`)}
                </ListSubheader>
              )
            }
          >
            {group.items.map((item) => (
              <ListItemButton
                key={item.key}
                component={Link}
                href={item.href}
                selected={isActive(item.href)}
                aria-current={isActive(item.href) ? 'page' : undefined}
                onClick={() => setMobileOpen(false)}
                className="mx-2 rounded-lg"
              >
                <ListItemIcon className="min-w-10">{ICONS[item.key]}</ListItemIcon>
                <ListItemText primary={t(`Nav.${item.key}`)} />
                {item.badge ? (
                  <Chip
                    size="small"
                    color="warning"
                    label={item.badge}
                    aria-label={t('Nav.pendingCount', { count: item.badge })}
                  />
                ) : null}
              </ListItemButton>
            ))}
          </List>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[1300] focus:rounded-md focus:bg-secondary focus:px-4 focus:py-2 focus:text-secondary-contrast"
      >
        {t('Common.skipToContent')}
      </a>

      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        className="md:hidden"
        slotProps={{ paper: { className: 'w-[264px]' } }}
      >
        {drawerContent}
      </Drawer>
      <Drawer
        variant="permanent"
        open
        className="hidden w-[264px] shrink-0 md:block"
        slotProps={{ paper: { className: 'w-[264px] border-r border-line' } }}
      >
        {drawerContent}
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <AppBar position="sticky" color="inherit" elevation={0} className="border-b border-line">
          <Toolbar className="gap-2">
            <IconButton
              edge="start"
              aria-label={t('Shell.openMenu')}
              onClick={() => setMobileOpen(true)}
              className="md:hidden"
            >
              <MenuOutlined />
            </IconButton>

            <Button
              color="inherit"
              startIcon={<AppsOutlined />}
              onClick={(event) => setTenantMenu(event.currentTarget)}
              aria-haspopup="menu"
              aria-label={`${t('Shell.switchTenant')}: ${tenant.name}`}
              className="max-w-[60vw] truncate font-semibold"
            >
              {tenant.name}
            </Button>
            <Menu
              anchorEl={tenantMenu}
              open={tenantMenu !== null}
              onClose={() => setTenantMenu(null)}
            >
              {tenants.map((item) => (
                <MenuItem
                  key={item.slug}
                  component={Link}
                  href={`/t/${item.slug}/dashboard`}
                  selected={item.slug === tenant.slug}
                  onClick={() => setTenantMenu(null)}
                >
                  {item.name}
                </MenuItem>
              ))}
              <Divider />
              <MenuItem component={Link} href="/select-tenant" onClick={() => setTenantMenu(null)}>
                {t('Shell.allTenants')}
              </MenuItem>
            </Menu>

            <div className="flex-1" />
            <LocaleSwitcher />
            <ThemeToggle />
            <IconButton
              aria-label={t('Shell.account')}
              aria-haspopup="menu"
              onClick={(event) => setUserMenu(event.currentTarget)}
            >
              <Avatar className="size-9 bg-primary text-sm text-primary-contrast">
                {initials(user)}
              </Avatar>
            </IconButton>
            <Menu anchorEl={userMenu} open={userMenu !== null} onClose={() => setUserMenu(null)}>
              <div className="px-4 py-2">
                <Typography variant="subtitle2">{user.name ?? user.email}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {user.email}
                </Typography>
              </div>
              <Divider />
              {user.isPlatformAdmin ? (
                <MenuItem component={Link} href="/admin/tenants" onClick={() => setUserMenu(null)}>
                  {t('Shell.platformAdmin')}
                </MenuItem>
              ) : null}
              <MenuItem onClick={() => void logout()}>
                <ListItemIcon>
                  <LogoutOutlined fontSize="small" />
                </ListItemIcon>
                {t('Auth.signOut')}
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        <main
          id="main-content"
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
