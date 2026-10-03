/**
 * Panel de colas con BullMQ: contadores por cola y trabajos fallidos (los que agotaron sus
 * reintentos). Solo opera sobre las colas conocidas de `QUEUE_NAMES`.
 */
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { FailedJobView, QueueAdmin, QueueCounts } from '@/core/platform/platform-admin';
import { QUEUE_NAMES, type QueueName } from './queue-names';

const KNOWN_QUEUES: readonly QueueName[] = Object.values(QUEUE_NAMES);
const MAX_REASON_LENGTH = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tenantOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('tenantId' in data)) return null;
  const { tenantId } = data;
  return typeof tenantId === 'string' && UUID_PATTERN.test(tenantId) ? tenantId : null;
}

export class BullQueueAdmin implements QueueAdmin {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(private readonly connection: Redis) {}

  private queue(name: string): Queue | null {
    const known = KNOWN_QUEUES.find((queue) => queue === name);
    if (!known) return null;
    let queue = this.queues.get(known);
    if (!queue) {
      queue = new Queue(known, { connection: this.connection });
      this.queues.set(known, queue);
    }
    return queue;
  }

  async overview(): Promise<QueueCounts[]> {
    return Promise.all(
      KNOWN_QUEUES.map(async (name) => {
        const queue = this.queue(name);
        if (!queue) throw new Error(`Cola desconocida: ${name}`);
        const [counts, paused] = await Promise.all([
          queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
          queue.isPaused(),
        ]);
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
          paused,
        };
      }),
    );
  }

  async failed(name: string, limit: number): Promise<FailedJobView[]> {
    const queue = this.queue(name);
    if (!queue) return [];
    const jobs = await queue.getFailed(0, limit - 1);
    return jobs.map((job) => ({
      id: job.id ?? '',
      name: job.name,
      tenantId: tenantOf(job.data),
      attemptsMade: job.attemptsMade,
      failedReason: (job.failedReason ?? '').slice(0, MAX_REASON_LENGTH),
      failedAt: job.finishedOn ? new Date(job.finishedOn) : null,
    }));
  }

  async retry(name: string, jobId: string): Promise<boolean> {
    const job = await this.queue(name)?.getJob(jobId);
    if (!job || !(await job.isFailed())) return false;
    await job.retry('failed');
    return true;
  }

  async remove(name: string, jobId: string): Promise<boolean> {
    const job = await this.queue(name)?.getJob(jobId);
    if (!job) return false;
    await job.remove();
    return true;
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
