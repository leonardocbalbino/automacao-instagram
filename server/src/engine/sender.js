import { UnrecoverableError } from 'bullmq';
import { one, query } from '../lib/db.js';
import { clientFor, buildMessage, GraphError } from '../lib/graph.js';
import { config } from '../config.js';
import { loadAutomation, action } from './automations.js';
import { pickVariation } from './matcher.js';

const DAY = 86_400_000;

function linkUrl(link) {
  return link ? `${config.publicUrl}/l/${link.slug}` : '';
}

function render(text, { link, username }) {
  return String(text || '')
    .replaceAll('{link}', linkUrl(link))
    .replaceAll('{username}', username ? `@${username}` : '')
    .trim();
}

async function logOutgoing({ accountId, conversationId, eventId, tipo, conteudo, linkId, erro }) {
  await query(
    `INSERT INTO messages_log (account_id, conversation_id, comment_event_id, direcao, tipo, conteudo, link_id, erro)
     VALUES ($1, $2, $3, 'saida', $4, $5, $6, $7)`,
    [accountId, conversationId || null, eventId || null, tipo, JSON.stringify(conteudo), linkId || null, erro || null],
  );
}

// Erros que não melhoram com retentativa (permissão, destinatário inválido, janela fechada)
function isPermanent(err) {
  return err instanceof GraphError && !err.isRateLimit && err.status >= 400 && err.status < 500 && !err.isAuthError;
}

async function conversationFor(accountId, igsid) {
  return one(
    `INSERT INTO conversations (account_id, igsid) VALUES ($1, $2)
     ON CONFLICT (account_id, igsid) DO UPDATE SET igsid = EXCLUDED.igsid RETURNING *`,
    [accountId, igsid],
  );
}

function windowOpen(conversation) {
  const last = conversation?.ultima_msg_usuario_em;
  return last && Date.now() - new Date(last).getTime() < DAY;
}

// Primeira DM do fluxo comentário → DM (resposta privada, 1 por comentário)
function firstMessage(automation, event) {
  const ctx = { link: automation.link, username: event.autor_username };
  const follow = action(automation, 'exigir_seguir');
  if (follow) {
    const text = render(follow.conteudo.texto || 'Me segue e toque em "Já sigo" que eu te mando o link 👇', ctx);
    return buildMessage(text, [{ title: follow.conteudo.botao || 'Já sigo', payload: `FOLLOW:${event.id}` }]);
  }
  const dm = action(automation, 'dm');
  const text = render(dm?.conteudo.texto || 'Aqui está: {link}', ctx);
  return buildMessage(text, buttonsFor(automation, event));
}

function buttonsFor(automation, event) {
  const button = action(automation, 'botao');
  if (!button?.conteudo.titulo) return [];
  if (action(automation, 'material')) return [{ title: button.conteudo.titulo, payload: `MATERIAL:${event.id}` }];
  if (automation.link) return [{ title: button.conteudo.titulo, url: linkUrl(automation.link) }];
  return [];
}

async function loadEvent(eventId) {
  return one(
    `SELECT ce.*, row_to_json(a) AS account FROM comment_events ce
     JOIN ig_accounts a ON a.id = ce.account_id WHERE ce.id = $1`,
    [eventId],
  );
}

export async function sendCommentReply(job) {
  const event = await loadEvent(job.data.eventId);
  if (!event || event.status !== 'na_fila') return 'ignorado';

  if (Date.now() - new Date(event.recebido_em).getTime() > 7 * DAY) {
    await query(`UPDATE comment_events SET status = 'expirado' WHERE id = $1`, [event.id]);
    return 'expirado';
  }

  const automation = await loadAutomation(event.automation_id);
  if (!automation) return 'sem automação';
  const client = clientFor(event.account);

  // Resposta pública (opcional) com variação de texto para não repetir
  const publicReply = action(automation, 'resposta_publica');
  if (publicReply && !job.data.publicDone) {
    const text = render(pickVariation(publicReply.conteudo.variacoes), { username: event.autor_username });
    if (text) {
      try {
        await client.replyToComment(event.comment_id, text);
        await logOutgoing({ accountId: event.account_id, eventId: event.id, tipo: 'resposta_publica', conteudo: { text } });
      } catch (err) {
        if (!isPermanent(err)) throw err;
        await logOutgoing({ accountId: event.account_id, eventId: event.id, tipo: 'resposta_publica', conteudo: { text }, erro: err.message });
      }
    }
    await job.updateData({ ...job.data, publicDone: true });
  }

  const message = firstMessage(automation, event);
  const conversation = event.autor_igsid ? await conversationFor(event.account_id, event.autor_igsid) : null;
  if (conversation && event.autor_username) {
    await query(`UPDATE conversations SET username = $2 WHERE id = $1`, [conversation.id, event.autor_username]);
  }

  try {
    await client.privateReply(event.comment_id, message);
  } catch (err) {
    if (!isPermanent(err)) throw err;
    await query(`UPDATE comment_events SET status = 'falhou', erro = $2 WHERE id = $1`, [event.id, err.message]);
    await logOutgoing({ accountId: event.account_id, conversationId: conversation?.id, eventId: event.id, tipo: 'resposta_privada', conteudo: message, erro: err.message });
    return 'falhou';
  }

  const status = action(automation, 'exigir_seguir') ? 'aguardando_seguir' : 'dm_enviada';
  await query(`UPDATE comment_events SET status = $2, respondido_em = now(), erro = NULL WHERE id = $1`, [event.id, status]);
  await logOutgoing({
    accountId: event.account_id,
    conversationId: conversation?.id,
    eventId: event.id,
    tipo: 'resposta_privada',
    conteudo: message,
    linkId: action(automation, 'exigir_seguir') ? null : automation.link?.id,
  });
  return status;
}

// DM comum: só dentro da janela de 24h após a última mensagem da pessoa
async function sendDirect({ account, conversation, eventId, tipo, message, linkId }) {
  if (!windowOpen(conversation)) {
    await logOutgoing({ accountId: account.id, conversationId: conversation.id, eventId, tipo, conteudo: message, erro: 'janela de 24h fechada' });
    return false;
  }
  try {
    await clientFor(account).sendMessage(conversation.igsid, message);
  } catch (err) {
    if (!isPermanent(err)) throw err;
    await logOutgoing({ accountId: account.id, conversationId: conversation.id, eventId, tipo, conteudo: message, erro: err.message });
    return false;
  }
  await logOutgoing({ accountId: account.id, conversationId: conversation.id, eventId, tipo, conteudo: message, linkId });
  return true;
}

export async function sendMaterial(job) {
  const event = await loadEvent(job.data.eventId);
  if (!event || event.status !== 'dm_enviada') return 'ignorado';
  const automation = await loadAutomation(event.automation_id);
  const material = automation && action(automation, 'material');
  if (!material) return 'sem material';

  const conversation = await conversationFor(event.account_id, event.autor_igsid);
  const message = buildMessage(render(material.conteudo.texto, { link: automation.link, username: event.autor_username }));
  const sent = await sendDirect({ account: event.account, conversation, eventId: event.id, tipo: 'material', message, linkId: automation.link?.id });
  if (sent) await query(`UPDATE comment_events SET status = 'material_enviado' WHERE id = $1`, [event.id]);
  return sent ? 'enviado' : 'bloqueado';
}

// "Siga para receber": confere se a pessoa segue antes de mandar o link
export async function followCheck(job) {
  const event = await loadEvent(job.data.eventId);
  if (!event || event.status !== 'aguardando_seguir') return 'ignorado';
  const automation = await loadAutomation(event.automation_id);
  if (!automation) return 'sem automação';

  const profile = await clientFor(event.account).userProfile(event.autor_igsid);
  const follows = Boolean(profile.is_user_follow_business);
  const conversation = await one(
    `UPDATE conversations SET segue_conta = $3, username = COALESCE($4, username)
     WHERE account_id = $1 AND igsid = $2 RETURNING *`,
    [event.account_id, event.autor_igsid, follows, profile.username || null],
  );
  const ctx = { link: automation.link, username: event.autor_username };

  if (!follows) {
    const follow = action(automation, 'exigir_seguir');
    const text = render(follow?.conteudo.texto_nao_segue || 'Ainda não encontrei o seu follow 🙂 Siga a conta e toque no botão de novo.', ctx);
    const message = buildMessage(text, [{ title: follow?.conteudo.botao || 'Já sigo', payload: `FOLLOW:${event.id}` }]);
    await sendDirect({ account: event.account, conversation, eventId: event.id, tipo: 'botao', message });
    return 'nao segue';
  }

  const dm = action(automation, 'dm');
  const message = buildMessage(render(dm?.conteudo.texto || 'Aqui está: {link}', ctx), buttonsFor(automation, event));
  const sent = await sendDirect({ account: event.account, conversation, eventId: event.id, tipo: 'texto', message, linkId: automation.link?.id });
  if (sent) await query(`UPDATE comment_events SET status = 'dm_enviada', respondido_em = now() WHERE id = $1`, [event.id]);
  return sent ? 'enviado' : 'bloqueado';
}

// Resposta automática a DM ou story
export async function sendDmReply(job) {
  const conversation = await one(`SELECT * FROM conversations WHERE id = $1`, [job.data.conversationId]);
  const automation = await loadAutomation(job.data.automationId);
  if (!conversation || !automation) return 'ignorado';
  const account = await one(`SELECT * FROM ig_accounts WHERE id = $1`, [conversation.account_id]);
  const dm = action(automation, 'dm');
  if (!dm) return 'sem dm';

  const text = render(dm.conteudo.texto, { link: automation.link, username: conversation.username });
  const button = action(automation, 'botao');
  const buttons = button?.conteudo.titulo && automation.link ? [{ title: button.conteudo.titulo, url: linkUrl(automation.link) }] : [];
  const sent = await sendDirect({ account, conversation, tipo: 'texto', message: buildMessage(text, buttons), linkId: automation.link?.id });
  return sent ? 'enviado' : 'bloqueado';
}

export const handlers = {
  'comment-reply': sendCommentReply,
  material: sendMaterial,
  'follow-check': followCheck,
  'dm-reply': sendDmReply,
};

export async function runSendJob(job) {
  const handler = handlers[job.name];
  if (!handler) throw new UnrecoverableError(`job desconhecido: ${job.name}`);
  try {
    return await handler(job);
  } catch (err) {
    // Token inválido não melhora com retentativa: falha já e deixa o worker marcar a conta
    if (err instanceof GraphError && err.isAuthError) {
      const unrecoverable = new UnrecoverableError(err.message);
      unrecoverable.authError = true;
      throw unrecoverable;
    }
    throw err;
  }
}
