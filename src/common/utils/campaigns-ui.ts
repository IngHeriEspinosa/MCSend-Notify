/** Utilidades de presentación de campañas compartidas por Server y Client Components. */
import type { CampaignStatus } from '@/core/campaigns/campaign';

export const CAMPAIGN_STATUS_TONE: Record<
  CampaignStatus,
  'default' | 'info' | 'success' | 'warning' | 'error' | 'primary'
> = {
  DRAFT: 'default',
  PENDING_APPROVAL: 'warning',
  SCHEDULED: 'primary',
  DISPATCHING: 'info',
  SENDING: 'info',
  PAUSED: 'warning',
  SENT: 'success',
  CANCELLED: 'default',
  FAILED: 'error',
};

/** Porcentaje con un decimal (0 si no hay base). */
export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}
