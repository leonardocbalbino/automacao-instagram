import { Worker, UnrecoverableError } from 'bullmq';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { createRedis } from '../lib/redis.js';
import { QUEUE, maintenanceQueue } from '../lib/queues.js';
import { GraphError } from '../lib/graph.js';
import { alert } from '../lib/alerts.js';
import { processEntry } from '../engine/rules.js';
import { runSendJob } from '../engine/sender.js';
import { publishPost } from '../engine/publisher.js';
import { refreshTokens, healthCheck } from '../engine/maintenance.js';
import { migrate } from '../migrate.js';

const workers = [];
const sendWorkers = new Map();

function onFinalFailure(worker, fn) {
  worker.on('failed', async (job, err) => {
    logger.error({ queue: worker.name, job: job?.name, id: job?.id, err: err.message }, 'job falhou');
    const exhausted = job && (job.attemptsMade >= (job.opts.attempts || 1) || err.name === 'UnrecoverableError');
    if (!exhausted) return;
    try {
      await fn(job, err);
    } catch (e) {
      logger.error(e, 'falha ao registrar erro do job');
    }
  });
}

async function markAuthError(accountId, err) {
  if ((err instanceof GraphError && err.isAuthError) || err.authError) {
    await query(`UPDATE ig_accounts SET status = 'expirada' WHERE id = $1`, [accountId]);
    await alert(`Token da conta ${accountId} inválido ou expirado: ${err.message}`);
  }
}

// Fila de envio por conta: concorrência 1 e limite de 750/h
function startSendWorker(accountId) {
  const name = QUEUE.send(accountId);
  if (sendWorkers.has(name)) return;
  const worker = new Worker(name, runSendJob, {
    connection: createRedis(),
    concurrency: 1,
    limiter: { max: config.limits.privateRepliesPerHour, duration: 3_600_000 },
  });
  onFinalFailure(worker, async (job, err) => {
    if (job.name === 'comment-reply') {
      await query(`UPDATE comment_events SET status = 'falhou', erro = $2 WHERE id = $1 AND status = 'na_fila'`, [
        job.data.eventId,
        err.message,
      ]);
    }
    await markAuthError(accountId, err);
  });
  sendWorkers.set(name, worker);
  logger.info({ accountId }, 'worker de envio iniciado');
}

async function syncSendWorkers() {
  const { rows } = await query(`SELECT id FROM ig_accounts WHERE status <> 'desconectada'`);
  for (const { id } of rows) startSendWorker(id);
}

async function main() {
  await migrate();
  const webhooks = new Worker(QUEUE.webhooks, (job) => processEntry(job.data.entry), {
    connection: createRedis(),
    concurrency: 10,
  });
  onFinalFailure(webhooks, async (job, err) => alert(`Webhook não processado após retentativas: ${err.message}`));

  const posts = new Worker(
    QUEUE.posts,
    (job, token) =>
      publishPost(job, token).catch((err) => {
        if (err instanceof GraphError && err.isAuthError) {
          const unrecoverable = new UnrecoverableError(err.message);
          unrecoverable.authError = true;
          throw unrecoverable;
        }
        throw err;
      }),
    { connection: createRedis(), concurrency: 3 });
  onFinalFailure(posts, async (job, err) => {
    const { rows } = await query(
      `UPDATE posts SET status = 'falhou', erro = $2 WHERE id = $1 RETURNING account_id`,
      [job.data.postId, err.message],
    );
    if (rows[0]) await markAuthError(rows[0].account_id, err);
    await alert(`Post ${job.data.postId} falhou: ${err.message}`);
  });

  const maintenance = new Worker(
    QUEUE.maintenance,
    async (job) => {
      if (job.name === 'refresh-tokens') return refreshTokens();
      if (job.name === 'health') return healthCheck();
      if (job.name === 'sync-workers') return syncSendWorkers();
    },
    { connection: createRedis() },
  );

  workers.push(webhooks, posts, maintenance);

  await maintenanceQueue.upsertJobScheduler('refresh-tokens', { pattern: '0 4 * * *' }, { name: 'refresh-tokens' });
  await maintenanceQueue.upsertJobScheduler('health', { every: 300_000 }, { name: 'health' });

  await syncSendWorkers();
  setInterval(() => syncSendWorkers().catch((err) => logger.error(err, 'sync de workers')), 30_000);

  logger.info('workers no ar');
}

async function shutdown() {
  logger.info('encerrando workers');
  await Promise.allSettled([...workers, ...sendWorkers.values()].map((w) => w.close()));
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((err) => {
  logger.error(err, 'falha ao iniciar workers');
  process.exit(1);
});
