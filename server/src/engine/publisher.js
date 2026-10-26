import { DelayedError } from 'bullmq';
import { one, query } from '../lib/db.js';
import { clientFor } from '../lib/graph.js';
import { logger } from '../lib/logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Vídeos levam tempo para processar; imagens costumam ficar prontas na hora
async function waitReady(client, containerId, { timeoutMs = 15 * 60_000 } = {}) {
  const started = Date.now();
  let interval = 3000;
  while (Date.now() - started < timeoutMs) {
    const { status_code: status, status: detail } = await client.containerStatus(containerId);
    if (status === 'FINISHED' || status === 'PUBLISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      const err = new Error(`Container ${status}: ${detail || ''}`.trim());
      err.containerFailed = true;
      throw err;
    }
    await sleep(interval);
    interval = Math.min(interval * 1.5, 20_000);
  }
  throw new Error('Tempo esgotado aguardando o processamento da mídia');
}

function itemParams(item, extra = {}) {
  return item.kind === 'video' ? { media_type: 'VIDEO', video_url: item.url, ...extra } : { image_url: item.url, ...extra };
}

async function createContainer(client, post) {
  const media = post.media_urls;
  if (!media.length) throw new Error('Post sem mídia');

  switch (post.tipo) {
    case 'imagem':
      return (await client.createContainer({ image_url: media[0].url, caption: post.legenda })).id;
    case 'reel':
      return (await client.createContainer({ media_type: 'REELS', video_url: media[0].url, caption: post.legenda, share_to_feed: 'true' })).id;
    case 'story': {
      const params = media[0].kind === 'video' ? { video_url: media[0].url } : { image_url: media[0].url };
      return (await client.createContainer({ media_type: 'STORIES', ...params })).id;
    }
    case 'carrossel': {
      if (media.length < 2 || media.length > 10) throw new Error('Carrossel precisa de 2 a 10 itens');
      const children = [];
      for (const item of media) {
        const { id } = await client.createContainer(itemParams(item, { is_carousel_item: 'true' }));
        children.push(id);
      }
      for (const id of children) await waitReady(client, id);
      return (await client.createContainer({ media_type: 'CAROUSEL', children: children.join(','), caption: post.legenda })).id;
    }
    default:
      throw new Error(`Tipo desconhecido: ${post.tipo}`);
  }
}

export async function publishPost(job, token) {
  const post = await one(
    `SELECT p.*, row_to_json(a) AS account FROM posts p JOIN ig_accounts a ON a.id = p.account_id WHERE p.id = $1`,
    [job.data.postId],
  );
  if (!post || post.status === 'publicado' || post.status === 'rascunho') return 'ignorado';
  if (post.agendado_para && new Date(post.agendado_para).getTime() > Date.now() + 5000) return 'reagendado';

  await query(`UPDATE posts SET status = 'publicando', erro = NULL WHERE id = $1`, [post.id]);
  const client = clientFor(post.account);

  // Limite de 100 publicações por 24h móveis: espera 1h e tenta de novo, sem gastar retentativa
  const limit = (await client.publishingLimit()).data?.[0];
  if (limit && limit.quota_usage >= (limit.config?.quota_total ?? 100)) {
    logger.warn({ postId: post.id, limit }, 'limite de publicação atingido; adiando 1h');
    await job.moveToDelayed(Date.now() + 3_600_000, token);
    throw new DelayedError();
  }

  let containerId = job.data.containerId;
  if (!containerId) {
    containerId = await createContainer(client, post);
    await job.updateData({ ...job.data, containerId });
  }

  try {
    await waitReady(client, containerId);
  } catch (err) {
    // Container perdido: na próxima tentativa cria outro
    if (err.containerFailed) await job.updateData({ ...job.data, containerId: null });
    throw err;
  }

  const { id: mediaId } = await client.publish(containerId);
  const info = await client.mediaInfo(mediaId).catch(() => ({}));

  await query(
    `UPDATE posts SET status = 'publicado', ig_media_id = $2, permalink = $3, publicado_em = now(), erro = NULL WHERE id = $1`,
    [post.id, mediaId, info.permalink || null],
  );
  // Regra vinculada ao post passa a valer para a mídia publicada
  await query(
    `UPDATE automations SET media_ids = array_append(media_ids, $2), escopo = 'lista', ativo = true
     WHERE post_id = $1 AND NOT ($2 = ANY(media_ids))`,
    [post.id, mediaId],
  );
  return mediaId;
}
