import { Queue } from 'bullmq';
import { query } from '../lib/db.js';
import { config } from '../config.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { refreshLongLived } from '../lib/graph.js';
import { redis } from '../lib/redis.js';
import { connection, QUEUE, webhooksQueue, postsQueue } from '../lib/queues.js';
import { alert } from '../lib/alerts.js';
import { logger } from '../lib/logger.js';

// Token longo vale 60 dias; renova quando faltam 15 (precisa ter pelo menos 24h)
export async function refreshTokens() {
  const { rows } = await query(
    `SELECT * FROM ig_accounts
     WHERE status IN ('ativa', 'expirando')
       AND token_expira_em < now() + interval '15 days'
       AND token_renovado_em < now() - interval '1 day'`,
  );
  for (const account of rows) {
    try {
      const data = await refreshLongLived(decrypt(account.access_token, config.tokenEncryptionKey));
      await query(
        `UPDATE ig_accounts SET access_token = $2, token_expira_em = now() + make_interval(secs => $3),
           token_renovado_em = now(), status = 'ativa' WHERE id = $1`,
        [account.id, encrypt(data.access_token, config.tokenEncryptionKey), data.expires_in],
      );
      logger.info({ account: account.username }, 'token renovado');
    } catch (err) {
      const expired = new Date(account.token_expira_em) < new Date();
      await query(`UPDATE ig_accounts SET status = $2 WHERE id = $1`, [account.id, expired ? 'expirada' : 'expirando']);
      await alert(`Falha ao renovar o token de @${account.username}: ${err.message}`);
    }
  }
  // Aviso 7 dias antes do vencimento
  const { rows: soon } = await query(
    `SELECT username, token_expira_em FROM ig_accounts
     WHERE status <> 'desconectada' AND token_expira_em < now() + interval '7 days'`,
  );
  for (const a of soon) await alert(`Token de @${a.username} vence em ${new Date(a.token_expira_em).toISOString()}`);
}

export async function healthCheck() {
  // Taxa de erro da Graph API na última janela fechada de 5 minutos
  const bucket = Math.floor(Date.now() / 300_000) - 1;
  const [ok, err] = await redis.mget(`metrics:graph:${bucket}:ok`, `metrics:graph:${bucket}:err`);
  const total = Number(ok || 0) + Number(err || 0);
  if (total >= 20 && Number(err || 0) / total > config.limits.errorRateAlert) {
    await alert(`Taxa de erro da API da Meta em ${((Number(err) / total) * 100).toFixed(1)}% (${err}/${total})`);
  }

  // Filas acumuladas (post viral estourando o ritmo de envio)
  const { rows } = await query(`SELECT id, username FROM ig_accounts WHERE status <> 'desconectada'`);
  for (const account of rows) {
    const q = new Queue(QUEUE.send(account.id), { connection });
    const counts = await q.getJobCounts('waiting', 'delayed', 'prioritized');
    const size = counts.waiting + counts.delayed + counts.prioritized;
    if (size > config.limits.queueAlertSize) await alert(`Fila de envio de @${account.username} com ${size} itens`);
    await q.close();
  }
  for (const q of [webhooksQueue, postsQueue]) {
    const { waiting } = await q.getJobCounts('waiting');
    if (waiting > config.limits.queueAlertSize) await alert(`Fila ${q.name} com ${waiting} itens aguardando`);
  }
}
