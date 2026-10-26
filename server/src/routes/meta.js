import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { one, query } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { encrypt, verifySignature, parseSignedRequest } from '../lib/crypto.js';
import { exchangeCode, exchangeLongLived, clientFor } from '../lib/graph.js';
import { webhooksQueue } from '../lib/queues.js';
import { asyncHandler } from '../lib/auth.js';

// Rotas públicas chamadas pela Meta: webhooks, OAuth e callbacks de conformidade
const router = Router();

router.get('/webhooks/instagram', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token && token === config.meta.webhookVerifyToken) return res.status(200).send(challenge);
  res.sendStatus(403);
});

// Só valida e enfileira; responde 200 rápido e o worker faz o resto
router.post('/webhooks/instagram', async (req, res) => {
  if (!verifySignature(req.rawBody || Buffer.alloc(0), req.get('x-hub-signature-256'), config.meta.appSecret)) {
    logger.warn('assinatura de webhook inválida');
    return res.sendStatus(401);
  }
  const body = req.body || {};
  if (body.object !== 'instagram') return res.sendStatus(200);
  try {
    await webhooksQueue.addBulk((body.entry || []).map((entry) => ({ name: 'entry', data: { entry } })));
    res.sendStatus(200);
  } catch (err) {
    logger.error(err, 'falha ao enfileirar webhook');
    res.sendStatus(500); // a Meta reenvia
  }
});

router.get(
  '/oauth/instagram/callback',
  asyncHandler(async (req, res) => {
    const { code, state, error_description: errorDescription } = req.query;
    if (!code) return res.redirect(`/contas?erro=${encodeURIComponent(errorDescription || 'Autorização cancelada')}`);

    let userId;
    try {
      userId = Number(jwt.verify(String(state), config.jwtSecret).sub);
    } catch {
      return res.redirect('/contas?erro=Sessão%20de%20conexão%20expirada');
    }

    const short = await exchangeCode(String(code).replace(/#_$/, ''));
    const long = await exchangeLongLived(short.access_token);
    const accessToken = encrypt(long.access_token, config.tokenEncryptionKey);

    const tempAccount = { access_token: accessToken, ig_user_id: String(short.user_id) };
    const me = await clientFor(tempAccount).me();
    const igUserId = String(me.user_id || short.user_id);

    const account = await one(
      `INSERT INTO ig_accounts (user_id, ig_user_id, username, access_token, token_expira_em, token_renovado_em, status)
       VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5), now(), 'ativa')
       ON CONFLICT (ig_user_id) DO UPDATE SET user_id = EXCLUDED.user_id, username = EXCLUDED.username,
         access_token = EXCLUDED.access_token, token_expira_em = EXCLUDED.token_expira_em,
         token_renovado_em = now(), status = 'ativa'
       RETURNING *`,
      [userId, igUserId, me.username, accessToken, long.expires_in || 5_184_000],
    );

    try {
      await clientFor(account).subscribeWebhooks();
    } catch (err) {
      logger.error({ err: err.message }, 'falha ao assinar webhooks da conta');
      return res.redirect(`/contas?erro=${encodeURIComponent('Conta conectada, mas a assinatura de webhooks falhou: ' + err.message)}`);
    }
    res.redirect(`/contas?ok=${encodeURIComponent(me.username)}`);
  }),
);

// Usuário removeu o app nas configurações do Instagram
router.post(
  '/meta/deauthorize',
  asyncHandler(async (req, res) => {
    const data = parseSignedRequest(req.body.signed_request, config.meta.appSecret);
    if (!data) return res.sendStatus(400);
    await query(`UPDATE ig_accounts SET status = 'desconectada' WHERE ig_user_id = $1`, [String(data.user_id)]);
    res.sendStatus(200);
  }),
);

// LGPD: pedido de exclusão de dados vindo da Meta
router.post(
  '/meta/data-deletion',
  asyncHandler(async (req, res) => {
    const data = parseSignedRequest(req.body.signed_request, config.meta.appSecret);
    if (!data) return res.sendStatus(400);
    const igUserId = String(data.user_id);
    const code = nanoid(12);

    // Pode ser o dono de uma conta conectada ou alguém que interagiu com uma
    await query(`DELETE FROM ig_accounts WHERE ig_user_id = $1`, [igUserId]);
    await query(`DELETE FROM conversations WHERE igsid = $1`, [igUserId]);
    await query(
      `UPDATE comment_events SET autor_igsid = NULL, autor_username = NULL, texto = NULL WHERE autor_igsid = $1`,
      [igUserId],
    );
    await query(`INSERT INTO data_deletion_requests (confirmation_code, ig_user_id) VALUES ($1, $2)`, [code, igUserId]);
    res.json({ url: `${config.publicUrl}/exclusao/${code}`, confirmation_code: code });
  }),
);

router.get(
  '/exclusao/:code',
  asyncHandler(async (req, res) => {
    const row = await one(`SELECT * FROM data_deletion_requests WHERE confirmation_code = $1`, [req.params.code]);
    res
      .type('html')
      .send(
        row
          ? `<h1>Exclusão de dados</h1><p>Pedido ${row.confirmation_code}: ${row.status} em ${row.criado_em.toISOString()}.</p>`
          : '<h1>Exclusão de dados</h1><p>Código não encontrado.</p>',
      );
  }),
);

// Link curto próprio para medir cliques
router.get(
  '/l/:slug',
  asyncHandler(async (req, res) => {
    const link = await one(`UPDATE links SET cliques = cliques + 1 WHERE slug = $1 RETURNING url_destino`, [req.params.slug]);
    if (!link) return res.sendStatus(404);
    res.redirect(302, link.url_destino);
  }),
);

export default router;
