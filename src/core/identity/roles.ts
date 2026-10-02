/** Roles de un usuario dentro de un tenant, de mayor a menor privilegio. */
export const MEMBERSHIP_ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const PLATFORM_ROLES = ['SUPER_ADMIN', 'USER'] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

const ROLE_RANK: Record<MembershipRole, number> = { OWNER: 4, ADMIN: 3, EDITOR: 2, VIEWER: 1 };

export function roleRank(role: MembershipRole): number {
  return ROLE_RANK[role];
}

export function isMembershipRole(value: unknown): value is MembershipRole {
  return typeof value === 'string' && (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}
