'use server';

/** Server Actions de documentos: renombrar, reintentar, eliminar y consultar el estado. */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import { renameDocumentSchema } from '@/core/documents/document';
import { useCases } from '@/infrastructure/use-case-factory';

export const renameDocumentAction = tenantAction(
  renameDocumentSchema,
  ({ documentId, title }, context) => useCases.documents().rename(context, documentId, title),
);

export const retryDocumentAction = tenantAction(
  z.object({ documentId: z.uuid() }),
  ({ documentId }, context) => useCases.documents().retry(context, documentId),
);

export const deleteDocumentAction = tenantAction(
  z.object({ documentId: z.uuid() }),
  ({ documentId }, context) => useCases.documents().delete(context, documentId),
);

/** Estado de los documentos en proceso (sondeo desde la interfaz). */
export const documentStatusesAction = tenantAction(
  z.object({ documentIds: z.array(z.uuid()).max(100) }),
  async ({ documentIds }, context) => {
    const documents = await useCases.documents().list(context, {});
    const wanted = new Set(documentIds);
    return documents
      .filter((document) => wanted.has(document.id))
      .map((document) => ({ id: document.id, status: document.status }));
  },
  { refresh: false },
);
