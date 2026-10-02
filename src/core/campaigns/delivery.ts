/** Entregas (un mensaje por contacto y campaña), sus eventos y las estadísticas derivadas. */

export const DELIVERY_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'FAILED',
  'SUPPRESSED',
  'CANCELLED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_EVENT_TYPES = [
  'SENT',
  'DELIVERED',
  'OPENED',
  'CLICKED',
  'DOWNLOADED',
  'BOUNCED',
  'COMPLAINED',
  'UNSUBSCRIBED',
  'FAILED',
] as const;
export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number];

/** Una entrega en vuelo tras este tiempo se considera interrumpida (caída del worker). */
export const STALE_SENDING_MS = 10 * 60 * 1000;

export interface NewDeliveryEvent {
  deliveryId: string;
  campaignId: string;
  type: DeliveryEventType;
  source: 'tracking' | 'provider' | 'system';
  linkId?: string | undefined;
  ipHash?: string | undefined;
  userAgent?: string | undefined;
  isBot?: boolean | undefined;
  metadata?: Record<string, unknown> | undefined;
  occurredAt: Date;
}

export interface DeliveryView {
  id: string;
  email: string;
  variant: string | null;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  firstOpenedAt: Date | null;
  machineOpenOnly: boolean;
  firstClickedAt: Date | null;
  unsubscribedAt: Date | null;
}

export interface VariantStats {
  sent: number;
  opened: number;
  clicked: number;
}

export interface CampaignStats {
  total: number;
  byStatus: Record<DeliveryStatus, number>;
  /** Aperturas únicas de personas (excluye las solo automáticas, p. ej. Apple MPP). */
  opened: number;
  machineOpens: number;
  clicked: number;
  unsubscribed: number;
  downloads: number;
  variants: { A: VariantStats; B: VariantStats };
}

export interface LinkStats {
  linkId: string;
  position: number;
  url: string;
  clicks: number;
  uniqueClicks: number;
}

export interface DailyActivity {
  day: string;
  sent: number;
  opened: number;
  clicked: number;
}

/** Datos de una entrega para enviarla: destinatario, elegibilidad y proveedor. */
export interface DeliveryForSend {
  id: string;
  campaignId: string;
  contactId: string;
  email: string;
  variant: string | null;
  status: DeliveryStatus;
  attempts: number;
  providerConfigId: string;
  recipient: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    attributes: Record<string, unknown>;
  };
  /** Falso si el contacto ya no está activo, está suprimido o se dio de baja del tema. */
  eligible: boolean;
}

/**
 * Las aperturas automáticas (Apple Mail Privacy Protection y similares) piden la imagen sin que
 * la persona abra el correo. Se registran, pero no cuentan como apertura humana.
 */
export function isMachineOpen(userAgent: string | undefined): boolean {
  const agent = (userAgent ?? '').trim();
  return agent === '' || agent === 'Mozilla/5.0';
}

const LINK_SCANNERS = [
  'safe links',
  'proofpoint',
  'barracuda',
  'mimecast',
  'symantec',
  'trendmicro',
  'fortiguard',
  'urldefense',
  'bot',
  'crawler',
  'spider',
  'curl/',
  'python-requests',
];

/** Escáneres de enlaces de los filtros de correo: siguen todos los enlaces sin intervención humana. */
export function isLinkScanner(userAgent: string | undefined, method: string): boolean {
  if (method === 'HEAD') return true;
  const agent = (userAgent ?? '').toLowerCase();
  return agent === '' || LINK_SCANNERS.some((marker) => agent.includes(marker));
}

/** Email enmascarado para páginas públicas (`a***@dominio.com`). */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
