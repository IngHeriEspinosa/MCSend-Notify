'use server';

/** Server Actions de importación: configuración del mapeo y consulta de estado. */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import { configureImportSchema } from '@/core/contacts/use-cases/imports.use-cases';
import { useCases } from '@/infrastructure/use-case-factory';

export const configureImportAction = tenantAction(configureImportSchema, (input, context) =>
  useCases.configureImport().execute(context, input),
);

export const getImportStatusAction = tenantAction(
  z.object({ importId: z.uuid() }),
  async ({ importId }, context) => {
    const { record } = await useCases.getImport().execute(context, importId);
    return {
      status: record.status,
      totalRows: record.totalRows,
      createdCount: record.createdCount,
      updatedCount: record.updatedCount,
      skippedCount: record.skippedCount,
      invalidCount: record.invalidCount,
      hasErrorReport: record.errorReportKey !== null,
      error: record.error,
    };
  },
  { refresh: false },
);
