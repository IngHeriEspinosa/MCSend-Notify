/**
 * Recifrado de los secretos en reposo con la clave activa (`ENCRYPTION_ACTIVE_KEY_ID`).
 *
 * Recorre por lotes las columnas cifradas: credenciales de proveedores de correo, credenciales
 * de IA y secretos de webhooks salientes. Cada fila se descifra con su AAD y se vuelve a cifrar;
 * la escritura es condicional al valor leído, de modo que una edición simultánea desde la app
 * no se pisa. Una fila que no se puede descifrar (clave retirada o dato corrupto) se informa y
 * se deja intacta.
 */
import { aiCredentialsAad } from '@/core/ai/ai';
import { providerCredentialsAad } from '@/core/providers/use-cases/providers.use-cases';
import { webhookSecretAad } from '@/core/webhooks/webhook';
import type { PrismaClient } from '../persistence/prisma/generated/client';
import type { AesGcmSecretCipher } from './aes-gcm-secret-cipher';

const BATCH_SIZE = 200;

interface EncryptedRow {
  id: string;
  tenantId: string;
  value: string;
}

interface EncryptedColumn {
  table: string;
  aad(row: EncryptedRow): string;
  page(afterId: string | null): Promise<EncryptedRow[]>;
  /** Escribe solo si el valor sigue siendo `previous` (escritura condicional). */
  replace(row: EncryptedRow, next: string): Promise<boolean>;
}

export interface RotationReport {
  table: string;
  scanned: number;
  rotated: number;
  /** Ids que no se pudieron descifrar (clave desconocida o AAD incorrecto). */
  failed: string[];
}

const after = (afterId: string | null) => (afterId ? { id: { gt: afterId } } : {});

function encryptedColumns(prisma: PrismaClient): EncryptedColumn[] {
  return [
    {
      table: 'email_provider_configs.credentials_enc',
      aad: (row) => providerCredentialsAad(row.tenantId, row.id),
      page: async (afterId) =>
        (
          await prisma.emailProviderConfig.findMany({
            where: { credentialsEnc: { not: null }, ...after(afterId) },
            select: { id: true, tenantId: true, credentialsEnc: true },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
          })
        ).map((row) => ({ id: row.id, tenantId: row.tenantId, value: row.credentialsEnc ?? '' })),
      replace: async (row, next) =>
        (
          await prisma.emailProviderConfig.updateMany({
            where: { id: row.id, credentialsEnc: row.value },
            data: { credentialsEnc: next },
          })
        ).count > 0,
    },
    {
      table: 'ai_settings.credentials_enc',
      aad: (row) => aiCredentialsAad(row.tenantId, row.id),
      page: async (afterId) =>
        (
          await prisma.aiSettings.findMany({
            where: { credentialsEnc: { not: null }, ...after(afterId) },
            select: { id: true, tenantId: true, credentialsEnc: true },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
          })
        ).map((row) => ({ id: row.id, tenantId: row.tenantId, value: row.credentialsEnc ?? '' })),
      replace: async (row, next) =>
        (
          await prisma.aiSettings.updateMany({
            where: { id: row.id, credentialsEnc: row.value },
            data: { credentialsEnc: next },
          })
        ).count > 0,
    },
    {
      table: 'webhook_endpoints.secret_enc',
      aad: (row) => webhookSecretAad(row.tenantId, row.id),
      page: async (afterId) =>
        (
          await prisma.webhookEndpoint.findMany({
            where: after(afterId),
            select: { id: true, tenantId: true, secretEnc: true },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
          })
        ).map((row) => ({ id: row.id, tenantId: row.tenantId, value: row.secretEnc })),
      replace: async (row, next) =>
        (
          await prisma.webhookEndpoint.updateMany({
            where: { id: row.id, secretEnc: row.value },
            data: { secretEnc: next },
          })
        ).count > 0,
    },
  ];
}

export async function rotateSecrets(
  prisma: PrismaClient,
  cipher: AesGcmSecretCipher,
  options: { dryRun: boolean },
): Promise<RotationReport[]> {
  const reports: RotationReport[] = [];
  for (const column of encryptedColumns(prisma)) {
    const report: RotationReport = { table: column.table, scanned: 0, rotated: 0, failed: [] };
    let afterId: string | null = null;
    for (;;) {
      const rows = await column.page(afterId);
      for (const row of rows) {
        report.scanned += 1;
        if (!cipher.needsRotation(row.value)) continue;
        let plaintext: string;
        try {
          plaintext = cipher.decrypt(row.value, column.aad(row));
        } catch {
          report.failed.push(row.id);
          continue;
        }
        if (
          options.dryRun ||
          (await column.replace(row, cipher.encrypt(plaintext, column.aad(row))))
        ) {
          report.rotated += 1;
        }
      }
      if (rows.length < BATCH_SIZE) break;
      afterId = rows.at(-1)?.id ?? null;
    }
    reports.push(report);
  }
  return reports;
}
