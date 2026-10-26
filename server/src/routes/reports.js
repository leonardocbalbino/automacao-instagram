import { Router } from 'express';
import { query, one } from '../lib/db.js';
import { asyncHandler } from '../lib/auth.js';

const router = Router();

function accountFilter(req, params, column = 'a.id') {
  if (!req.query.account_id) return '';
  params.push(req.query.account_id);
  return `AND ${column} = $${params.length}`;
}

router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const params = [req.user.id];
    const filter = accountFilter(req, params);
    let statusFilter = '';
    if (req.query.status) {
      params.push(req.query.status);
      statusFilter = `AND ce.status = $${params.length}`;
    }
    params.push(Math.min(Number(req.query.limit) || 100, 500));
    const { rows } = await query(
      `SELECT ce.*, a.username AS conta, au.nome AS automacao
       FROM comment_events ce
       JOIN ig_accounts a ON a.id = ce.account_id
       LEFT JOIN automations au ON au.id = ce.automation_id
       WHERE a.user_id = $1 ${filter} ${statusFilter}
       ORDER BY ce.recebido_em DESC LIMIT $${params.length}`,
      params,
    );
    res.json(rows);
  }),
);

router.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const params = [req.user.id];
    const filter = accountFilter(req, params);
    params.push(Math.min(Number(req.query.limit) || 100, 500));
    const { rows } = await query(
      `SELECT m.*, a.username AS conta, c.igsid, c.username
       FROM messages_log m
       JOIN ig_accounts a ON a.id = m.account_id
       LEFT JOIN conversations c ON c.id = m.conversation_id
       WHERE a.user_id = $1 ${filter}
       ORDER BY m.enviado_em DESC LIMIT $${params.length}`,
      params,
    );
    res.json(rows);
  }),
);

// Funil comentários → DMs → cliques, por período
router.get(
  '/metrics',
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const params = [req.user.id, days];
    const filter = accountFilter(req, params);

    const funnel = await one(
      `SELECT
         count(*) FILTER (WHERE ce.status NOT IN ('proprio'))::int AS comentarios,
         count(*) FILTER (WHERE ce.automation_id IS NOT NULL)::int AS com_palavra_chave,
         count(*) FILTER (WHERE ce.status IN ('dm_enviada', 'material_enviado', 'aguardando_seguir'))::int AS dms,
         count(*) FILTER (WHERE ce.status = 'material_enviado')::int AS materiais,
         count(*) FILTER (WHERE ce.status = 'falhou')::int AS falhas
       FROM comment_events ce JOIN ig_accounts a ON a.id = ce.account_id
       WHERE a.user_id = $1 AND ce.recebido_em > now() - make_interval(days => $2) ${filter}`,
      params,
    );

    const { rows: byAutomation } = await query(
      `SELECT au.id, au.nome, au.gatilho, a.username,
         (SELECT count(*)::int FROM comment_events ce WHERE ce.automation_id = au.id
            AND ce.recebido_em > now() - make_interval(days => $2)) AS disparos,
         (SELECT count(*)::int FROM messages_log m JOIN links l ON l.id = m.link_id
            WHERE l.automation_id = au.id AND m.direcao = 'saida' AND m.erro IS NULL
            AND m.enviado_em > now() - make_interval(days => $2)) AS dms_com_link,
         COALESCE((SELECT sum(l.cliques)::int FROM links l WHERE l.automation_id = au.id), 0) AS cliques
       FROM automations au JOIN ig_accounts a ON a.id = au.account_id
       WHERE a.user_id = $1 ${filter}
       ORDER BY disparos DESC`,
      params,
    );

    const { rows: daily } = await query(
      `SELECT to_char(date_trunc('day', ce.recebido_em), 'YYYY-MM-DD') AS dia,
         count(*)::int AS comentarios,
         count(*) FILTER (WHERE ce.status IN ('dm_enviada', 'material_enviado', 'aguardando_seguir'))::int AS dms
       FROM comment_events ce JOIN ig_accounts a ON a.id = ce.account_id
       WHERE a.user_id = $1 AND ce.recebido_em > now() - make_interval(days => $2) AND ce.status <> 'proprio' ${filter}
       GROUP BY 1 ORDER BY 1`,
      params,
    );

    // Cliques são contados por link (sem data), então o total é acumulado
    const cliques = byAutomation.reduce((sum, a) => sum + a.cliques, 0);
    res.json({ days, funnel: { ...funnel, cliques }, byAutomation, daily });
  }),
);

export default router;
