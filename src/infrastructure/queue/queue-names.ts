/**
 * Nombres de colas de BullMQ. BullMQ no admite `:` en el nombre de una cola, por eso
 * las colas dinámicas de envío (Fase 3) usarán el formato `send-{emailProviderConfigId}`.
 */
export const QUEUE_NAMES = {
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/** Jobs de la cola de mantenimiento. */
export const MAINTENANCE_JOBS = {
  heartbeat: 'heartbeat',
} as const;
