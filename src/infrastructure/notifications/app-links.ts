/** URL absolutas de la app para los correos del sistema (base `APP_URL`). */
import type { AppLinks } from '@/core/automations/ports';
import type { TenantContext } from '@/core/shared/tenant-context';

export class AbsoluteAppLinks implements AppLinks {
  constructor(private readonly appUrl: string) {}

  approvalUrl(context: TenantContext, approvalId: string, locale: 'es' | 'en'): string {
    return new URL(
      `/${locale}/t/${encodeURIComponent(context.tenantSlug)}/approvals/${approvalId}`,
      this.appUrl,
    ).toString();
  }
}
