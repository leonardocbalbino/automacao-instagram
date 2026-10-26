import { config } from '../config.js';
import { redis } from './redis.js';
import { decrypt } from './crypto.js';

const GRAPH_HOST = 'https://graph.instagram.com';

export class GraphError extends Error {
  constructor(message, { status, code, subcode, body } = {}) {
    super(message);
    this.name = 'GraphError';
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.body = body;
  }

  // 190 = token inválido/expirado; 10/200 = permissão
  get isAuthError() {
    return this.code === 190;
  }

  get isRateLimit() {
    return [4, 17, 32, 613].includes(this.code) || this.status === 429;
  }
}

// Contadores em janelas de 5 min para o alerta de taxa de erro
async function trackApiCall(ok) {
  const bucket = Math.floor(Date.now() / 300_000);
  const key = `metrics:graph:${bucket}:${ok ? 'ok' : 'err'}`;
  await redis.multi().incr(key).expire(key, 3600).exec().catch(() => {});
}

async function request(method, url, { params = {}, body, token } = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  if (token) u.searchParams.set('access_token', token);

  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(u, init);
  } catch (err) {
    await trackApiCall(false);
    throw new GraphError(`Falha de rede: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    await trackApiCall(false);
    const e = data.error || {};
    throw new GraphError(e.message || `HTTP ${res.status}`, {
      status: res.status,
      code: e.code,
      subcode: e.error_subcode,
      body: data,
    });
  }
  await trackApiCall(true);
  return data;
}

const v = () => `${GRAPH_HOST}/${config.meta.graphVersion}`;

// ---------- OAuth (Instagram API com Instagram Login) ----------

export function authorizeUrl(state) {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', config.meta.appId);
  u.searchParams.set('redirect_uri', `${config.publicUrl}/oauth/instagram/callback`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', config.meta.scopes.join(','));
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode(code) {
  const form = new URLSearchParams({
    client_id: config.meta.appId,
    client_secret: config.meta.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: `${config.publicUrl}/oauth/instagram/callback`,
    code,
  });
  const res = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || data.error_message || data.error) {
    throw new GraphError(data.error_message || data.error?.message || 'Falha ao trocar o código', { body: data });
  }
  return data; // { access_token, user_id, permissions }
}

export function exchangeLongLived(shortToken) {
  return request('GET', `${GRAPH_HOST}/access_token`, {
    params: { grant_type: 'ig_exchange_token', client_secret: config.meta.appSecret, access_token: shortToken },
  }); // { access_token, token_type, expires_in }
}

export function refreshLongLived(token) {
  return request('GET', `${GRAPH_HOST}/refresh_access_token`, {
    params: { grant_type: 'ig_refresh_token', access_token: token },
  });
}

// ---------- Cliente por conta ----------

export function clientFor(account) {
  const token = decrypt(account.access_token, config.tokenEncryptionKey);
  const igId = account.ig_user_id;
  const get = (path, params) => request('GET', `${v()}/${path}`, { params, token });
  const post = (path, { params, body } = {}) => request('POST', `${v()}/${path}`, { params, body, token });

  return {
    me: () => get('me', { fields: 'user_id,username,name,profile_picture_url' }),
    subscribeWebhooks: () =>
      post('me/subscribed_apps', { params: { subscribed_fields: 'comments,live_comments,messages,messaging_postbacks' } }),

    // Publicação
    publishingLimit: () => get(`${igId}/content_publishing_limit`, { fields: 'quota_usage,config' }),
    createContainer: (params) => post(`${igId}/media`, { params }),
    containerStatus: (containerId) => get(containerId, { fields: 'status_code,status' }),
    publish: (creationId) => post(`${igId}/media_publish`, { params: { creation_id: creationId } }),
    mediaInfo: (mediaId) => get(mediaId, { fields: 'id,permalink,media_type,timestamp' }),

    // Comentários
    replyToComment: (commentId, message) => post(`${commentId}/replies`, { params: { message } }),

    // Mensagens
    privateReply: (commentId, message) =>
      post(`${igId}/messages`, { body: { recipient: { comment_id: commentId }, message } }),
    sendMessage: (igsid, message) => post(`${igId}/messages`, { body: { recipient: { id: igsid }, message } }),
    userProfile: (igsid) => get(igsid, { fields: 'name,username,is_user_follow_business,is_business_follow_user' }),
  };
}

// Monta a mensagem: texto simples ou template de botão (até 3 botões)
export function buildMessage(text, buttons = []) {
  if (!buttons.length) return { text };
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text,
        buttons: buttons.slice(0, 3).map((b) =>
          b.url ? { type: 'web_url', url: b.url, title: b.title } : { type: 'postback', title: b.title, payload: b.payload },
        ),
      },
    },
  };
}
