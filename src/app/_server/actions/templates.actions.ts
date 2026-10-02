'use server';

/** Server Actions de plantillas: alta, guardado con versión, restauración, vista previa. */
import { z } from 'zod';
import { tenantAction } from '@/app/_server/action-client';
import {
  createTemplateSchema,
  previewTemplateSchema,
  saveTemplateSchema,
} from '@/core/templates/use-cases/templates.use-cases';
import { useCases } from '@/infrastructure/use-case-factory';

export const createTemplateAction = tenantAction(createTemplateSchema, async (input, context) => {
  const template = await useCases.templates().create(context, input);
  return { id: template.id };
});

export const saveTemplateAction = tenantAction(saveTemplateSchema, async (input, context) => {
  const template = await useCases.templates().save(context, input);
  return { currentVersion: template.currentVersion };
});

export const restoreTemplateVersionAction = tenantAction(
  z.object({ templateId: z.uuid(), version: z.number().int().min(1) }),
  async ({ templateId, version }, context) => {
    const template = await useCases.templates().restore(context, templateId, version);
    return { currentVersion: template.currentVersion, body: template.body };
  },
);

export const duplicateTemplateAction = tenantAction(
  z.object({ templateId: z.uuid(), name: z.string().trim().min(2).max(120) }),
  async ({ templateId, name }, context) => {
    const template = await useCases.templates().duplicate(context, templateId, name);
    return { id: template.id };
  },
);

export const deleteTemplateAction = tenantAction(
  z.object({ templateId: z.uuid() }),
  ({ templateId }, context) => useCases.templates().delete(context, templateId),
);

export const previewTemplateAction = tenantAction(
  previewTemplateSchema,
  (input, context) => useCases.previewTemplate().execute(context, input),
  { refresh: false },
);
