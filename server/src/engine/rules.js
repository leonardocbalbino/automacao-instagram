import { one, query } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { sendQueue } from '../lib/queues.js';
import { config } from '../config.js';
import { loadAutomations, loadAutomation, action } from './automations.js';
import { findAutomation, jitter } from './matcher.js';

const delay = () => jitter(config.limits.jitterMinMs, config.limits.jitterMaxMs);

// Processa um "entry" de webhook já validado e enfileirado pelo receptor
export async function processEntry(entry) {
  const account = await one(`SELECT * FROM ig_accounts WHERE ig_user_id = $1 AND status <> 'desconectada'`, [
    String(entry.id),
  ]);
  if (!account) {
    logger.warn({ igId: entry.id }, 'webhook para conta desconhecida');
    return;
  }

  for (const change of entry.changes || []) {
    if (change.field === 'comments') await handleComment(account, change.value, 'comentario');
    else if (change.field === 'live_comments') await handleComment(account, change.value, 'live');
  }
  for (const event of entry.messaging || []) {
    await handleMessaging(account, event);
  }
}

export async function handleComment(account, value, origem) {
  if (!value?.id) return;
  const authorId = value.from?.id ? String(value.from.id) : null;
  const own = authorId === account.ig_user_id;

  // Trava de idempotência: um comentário só entra uma vez, mesmo com webhook duplicado
  const event = await one(
    `INSERT INTO comment_events (account_id, comment_id, origem, ig_media_id, autor_igsid, autor_username, texto, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (comment_id) DO NOTHING
     RETURNING *`,
    [
      account.id,
      String(value.id),
      origem,
      value.media?.id ? String(value.media.id) : null,
      authorId,
      value.from?.username || null,
      value.text || '',
      own ? 'proprio' : 'recebido',
    ],
  );
  if (!event || own) return;

  const automations = await loadAutomations(account.id, 'comentario');
  const automation = findAutomation(automations, { text: event.texto, mediaId: event.ig_media_id });
  if (!automation) {
    await query(`UPDATE comment_events SET status = 'ignorado' WHERE id = $1`, [event.id]);
    return;
  }

  await query(`UPDATE comment_events SET status = 'na_fila', automation_id = $2 WHERE id = $1`, [
    event.id,
    automation.id,
  ]);
  await sendQueue(account.id).add('comment-reply', { eventId: event.id }, { jobId: `comment-${event.id}`, delay: delay() });
}

async function upsertConversation(accountId, igsid, interactedAt) {
  return one(
    `INSERT INTO conversations (account_id, igsid, ultima_msg_usuario_em)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id, igsid) DO UPDATE
       SET ultima_msg_usuario_em = GREATEST(conversations.ultima_msg_usuario_em, EXCLUDED.ultima_msg_usuario_em)
     RETURNING *`,
    [accountId, igsid, interactedAt],
  );
}

export async function handleMessaging(account, event) {
  const senderId = event.sender?.id ? String(event.sender.id) : null;
  if (!senderId || senderId === account.ig_user_id || event.message?.is_echo) return;

  const at = new Date(event.timestamp || Date.now());
  const mid = event.message?.mid || event.postback?.mid || event.reaction?.mid || null;
  const conversation = await upsertConversation(account.id, senderId, at);

  let tipo = 'texto';
  if (event.postback) tipo = 'postback';
  else if (event.reaction) tipo = 'story_reacao';
  else if (event.message?.reply_to?.story) tipo = 'story_reply';

  // Dedup por mid: o mesmo webhook de mensagem pode chegar mais de uma vez
  const logged = await one(
    `INSERT INTO messages_log (account_id, conversation_id, direcao, tipo, conteudo, ig_mid, enviado_em)
     VALUES ($1, $2, 'entrada', $3, $4, $5, $6)
     ON CONFLICT (ig_mid) DO NOTHING
     RETURNING id`,
    [account.id, conversation.id, tipo, JSON.stringify(event.message || event.postback || event.reaction || {}), mid, at],
  );
  if (mid && !logged) return;

  const queue = sendQueue(account.id);

  if (event.postback) {
    const [kind, eventId] = String(event.postback.payload || '').split(':');
    if (kind === 'FOLLOW' && eventId) {
      await queue.add('follow-check', { eventId: Number(eventId) }, { delay: delay() });
    } else if (kind === 'MATERIAL' && eventId) {
      await queue.add('material', { eventId: Number(eventId) }, { jobId: `material-${eventId}`, delay: delay() });
    }
    return;
  }

  if (tipo === 'story_reply' || tipo === 'story_reacao') {
    const automations = await loadAutomations(account.id, 'story');
    const automation = findAutomation(automations, { text: event.message?.text || '' });
    if (automation) await queue.add('dm-reply', { conversationId: conversation.id, automationId: automation.id }, { delay: delay() });
    return;
  }

  const text = event.message?.text || '';

  // A pessoa respondeu à primeira DM de um comentário: janela de 24h aberta, envia o material
  const pending = await one(
    `SELECT ce.id, ce.automation_id FROM comment_events ce
     WHERE ce.account_id = $1 AND ce.autor_igsid = $2 AND ce.status = 'dm_enviada'
       AND ce.respondido_em > now() - interval '7 days'
     ORDER BY ce.respondido_em DESC LIMIT 1`,
    [account.id, senderId],
  );
  if (pending?.automation_id) {
    const automation = await loadAutomation(pending.automation_id);
    if (automation && action(automation, 'material')) {
      await queue.add('material', { eventId: pending.id }, { jobId: `material-${pending.id}`, delay: delay() });
      return;
    }
  }

  const automations = await loadAutomations(account.id, 'dm');
  const automation = findAutomation(automations, { text });
  if (automation) {
    await queue.add('dm-reply', { conversationId: conversation.id, automationId: automation.id }, { delay: delay() });
  }
}
