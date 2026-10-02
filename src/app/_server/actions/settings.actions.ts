'use server';

/** Server Actions de configuración del tenant y de la plataforma. */
import { z } from 'zod';
import { runAction, tenantAction } from '@/app/_server/action-client';
import { requirePlatformAdmin } from '@/app/_server/session';
import { createApiKeySchema } from '@/core/api-keys/api-keys';
import { createContactFieldSchema } from '@/core/contacts/contact-fields';
import { tagSchema, topicSchema } from '@/core/contacts/use-cases/audience.use-cases';
import { inviteMemberSchema } from '@/core/identity/use-cases/invite-member.use-case';
import { changeMemberRoleSchema } from '@/core/identity/use-cases/manage-members.use-case';
import { actorUserId } from '@/core/shared/tenant-context';
import { createTenantSchema, updateTenantSettingsSchema } from '@/core/tenants/tenant';
import { getLogger, getRateLimiter, getSystemMailQueue } from '@/infrastructure/container';
import { getServerEnv } from '@/common/config/env';
import { getLocale } from 'next-intl/server';
import { getOptionalUser } from '@/app/_server/session';
import { useCases } from '@/infrastructure/use-case-factory';

const idSchema = z.object({ id: z.uuid() });

// --- General -----------------------------------------------------------------
export const updateTenantSettingsAction = tenantAction(
  updateTenantSettingsSchema,
  async (input, context) => {
    await useCases.updateTenantSettings().execute(context, input);
  },
);

// --- Miembros ----------------------------------------------------------------
export const inviteMemberAction = tenantAction(inviteMemberSchema, async (input, context) => {
  await getRateLimiter('invitation').consume(actorUserId(context) ?? context.tenantId);
  const result = await useCases.inviteMember().execute(context, input);
  // El enlace se muestra siempre; además se envía por correo (si falla, no se pierde la invitación).
  let emailed = false;
  try {
    const [locale, inviter, profile] = await Promise.all([
      getLocale(),
      getOptionalUser(),
      useCases.branding().get(context),
    ]);
    const mailLocale = locale === 'en' ? 'en' : 'es';
    await getSystemMailQueue().enqueue({
      kind: 'invitation',
      to: input.email,
      locale: mailLocale,
      tenantName: profile.name,
      inviterName: inviter?.name ?? inviter?.email ?? null,
      url: new URL(`/${mailLocale}/invite/${result.token}`, getServerEnv().APP_URL).toString(),
      expiresAt: result.expiresAt,
    });
    emailed = true;
  } catch (error) {
    getLogger().warn({ err: error }, 'No se pudo encolar el correo de invitación');
  }
  return { token: result.token, expiresAt: result.expiresAt, emailed };
});

export const changeMemberRoleAction = tenantAction(changeMemberRoleSchema, (input, context) =>
  useCases.changeMemberRole().execute(context, input),
);

export const removeMemberAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.removeMember().execute(context, id),
);

export const revokeInvitationAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.revokeInvitation().execute(context, id),
);

// --- Claves de API -----------------------------------------------------------
export const createApiKeyAction = tenantAction(createApiKeySchema, async (input, context) => {
  const { apiKey, key } = await useCases.apiKeys().create(context, input);
  return { id: apiKey.id, key };
});

export const revokeApiKeyAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.apiKeys().revoke(context, id),
);

// --- Campos, etiquetas y temas ---------------------------------------------------
export const createContactFieldAction = tenantAction(
  createContactFieldSchema,
  async (input, context) => {
    await useCases.contactFields().create(context, input);
  },
);

export const deleteContactFieldAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.contactFields().delete(context, id),
);

export const createTagSettingsAction = tenantAction(tagSchema, async (input, context) => {
  await useCases.tags().create(context, input);
});

export const deleteTagAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.tags().delete(context, id),
);

export const createTopicAction = tenantAction(topicSchema, async (input, context) => {
  await useCases.topics().create(context, input);
});

export const updateTopicAction = tenantAction(
  z.object({ id: z.uuid(), topic: topicSchema.omit({ key: true }) }),
  async ({ id, topic }, context) => {
    await useCases.topics().update(context, id, topic);
  },
);

export const deleteTopicAction = tenantAction(idSchema, ({ id }, context) =>
  useCases.topics().delete(context, id),
);

// --- Plataforma ----------------------------------------------------------------
export async function createTenantAction(input: unknown) {
  return runAction(async () => {
    const user = await requirePlatformAdmin();
    const tenant = await useCases.createTenant().execute(user, createTenantSchema.parse(input));
    return { slug: tenant.slug };
  });
}
