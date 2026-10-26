import { Queue } from 'bullmq';
import { createRedis } from './redis.js';

export const connection = createRedis();

export const QUEUE = {
  webhooks: 'webhooks',
  posts: 'posts',
  maintenance: 'maintenance',
  send: (accountId) => `send-${accountId}`,
};

const defaults = { removeOnComplete: { age: 7 * 86400, count: 5000 }, removeOnFail: { age: 30 * 86400 } };

export const webhooksQueue = new Queue(QUEUE.webhooks, {
  connection,
  defaultJobOptions: { ...defaults, attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
});

export const postsQueue = new Queue(QUEUE.posts, {
  connection,
  defaultJobOptions: { ...defaults, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
});

export const maintenanceQueue = new Queue(QUEUE.maintenance, { connection, defaultJobOptions: defaults });

// Uma fila de envio por conta: o rate limiter do worker vale por conta
const sendQueues = new Map();
export function sendQueue(accountId) {
  const name = QUEUE.send(accountId);
  if (!sendQueues.has(name)) {
    sendQueues.set(
      name,
      new Queue(name, {
        connection,
        defaultJobOptions: { ...defaults, attempts: 4, backoff: { type: 'exponential', delay: 5000 } },
      }),
    );
  }
  return sendQueues.get(name);
}

export async function schedulePost(post) {
  const jobId = `post-${post.id}`;
  const existing = await postsQueue.getJob(jobId);
  if (existing) await existing.remove().catch(() => {});
  const delay = Math.max(0, new Date(post.agendado_para).getTime() - Date.now());
  await postsQueue.add('publish', { postId: post.id }, { jobId, delay });
}

export async function unschedulePost(postId) {
  const job = await postsQueue.getJob(`post-${postId}`);
  if (job) await job.remove().catch(() => {});
}
