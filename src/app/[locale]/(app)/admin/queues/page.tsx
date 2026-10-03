/** Panel de colas: contadores y trabajos fallidos (reintentar o descartar). Solo SUPER_ADMIN. */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requirePlatformAdmin } from '@/app/_server/session';
import { PageHeader } from '@/components/molecules/PageHeader';
import { QueuesAdmin } from '@/components/organisms/QueuesAdmin';
import { useCases } from '@/infrastructure/use-case-factory';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Admin');
  return { title: t('queuesTitle') };
}

export default async function AdminQueuesPage() {
  const user = await requirePlatformAdmin();
  const t = await getTranslations('Admin');

  return (
    <>
      <PageHeader title={t('queuesTitle')} subtitle={t('queuesSubtitle')} />
      <QueuesAdmin queues={await useCases.queues().overview(user)} />
    </>
  );
}
