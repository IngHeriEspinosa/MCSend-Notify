/**
 * Correo del sistema (invitaciones y recuperación de contraseña). Se envía desde el worker con
 * la cuenta SMTP de la plataforma (`SYSTEM_MAIL_*`), independiente de los proveedores de cada tenant.
 */
import { z } from 'zod';

export const systemMailMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('invitation'),
    to: z.email(),
    locale: z.enum(['es', 'en']),
    tenantName: z.string().min(1).max(120),
    inviterName: z.string().max(120).nullable(),
    url: z.url(),
    expiresAt: z.coerce.date(),
  }),
  z.object({
    kind: z.literal('password-reset'),
    to: z.email(),
    locale: z.enum(['es', 'en']),
    url: z.url(),
    expiresAt: z.coerce.date(),
  }),
]);

export type SystemMailMessage = z.infer<typeof systemMailMessageSchema>;

export interface SystemMailQueue {
  enqueue(message: SystemMailMessage): Promise<void>;
}

export interface SystemMailer {
  send(message: SystemMailMessage): Promise<void>;
}
