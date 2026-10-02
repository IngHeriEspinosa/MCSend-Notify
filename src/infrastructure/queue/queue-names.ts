/**
 * Nombres de colas de BullMQ (BullMQ no admite `:` en el nombre de una cola).
 * El envío usa una sola cola `email-send`; los límites por proveedor y por campaña se aplican en
 * Redis al procesar cada job, de modo que no hacen falta colas dinámicas por proveedor.
 */
export const QUEUE_NAMES = {
  maintenance: 'maintenance',
  contactImport: 'contact-import',
  documentProcess: 'document-process',
  campaignDispatch: 'campaign-dispatch',
  emailSend: 'email-send',
  providerEvents: 'provider-events',
  systemMail: 'system-mail',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Jobs de la cola de mantenimiento. */
export const MAINTENANCE_JOBS = {
  heartbeat: 'heartbeat',
  campaignsDue: 'campaigns-due',
  campaignsComplete: 'campaigns-complete',
  deliveriesRecover: 'deliveries-recover',
} as const;
