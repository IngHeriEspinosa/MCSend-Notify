'use server';

/** Server Actions del panel de plataforma (solo SUPER_ADMIN, validado también en el caso de uso). */
import { z } from 'zod';
import { runAction } from '@/app/_server/action-client';
import { requirePlatformAdmin } from '@/app/_server/session';
import { queueJobSchema } from '@/core/platform/platform-admin';
import { useCases } from '@/infrastructure/use-case-factory';

const queueSchema = z.object({ queue: queueJobSchema.shape.queue });

export async function listFailedJobsAction(input: unknown) {
  return runAction(
    async () => {
      const user = await requirePlatformAdmin();
      const { queue } = queueSchema.parse(input);
      return useCases.queues().failed(user, queue);
    },
    { refresh: false },
  );
}

export async function retryJobAction(input: unknown) {
  return runAction(async () => {
    const user = await requirePlatformAdmin();
    await useCases.queues().retry(user, queueJobSchema.parse(input));
  });
}

export async function removeJobAction(input: unknown) {
  return runAction(async () => {
    const user = await requirePlatformAdmin();
    await useCases.queues().remove(user, queueJobSchema.parse(input));
  });
}
