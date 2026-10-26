import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { query, transaction } from '../lib/db.js';
import { asyncHandler, ownedAccount, HttpError } from '../lib/auth.js';
import { loadAutomation, action } from '../engine/automations.js';
import { normalize } from '../engine/matcher.js';

const router = Router();

// O painel trabalha com um formulário único; no banco viram linhas de automation_actions
const schema = z
  .object({
    account_id: z.coerce.number(),
    nome: z.string().min(1),
    gatilho: z.enum(['comentario', 'dm', 'story']),
    escopo: z.enum(['todos', 'lista']).default('todos'),
    media_ids: z.array(z.string()).default([]),
    post_id: z.coerce.number().nullable().optional(),
    ativo: z.boolean().default(true),
    keywords: z.array(z.object({ palavra: z.string().min(1), modo: z.enum(['exata', 'contem']).default('contem') })).default([]),
    resposta_publica: z.object({ variacoes: z.array(z.string()).min(1) }).nullable().optional(),
    dm: z.object({ texto: z.string().min(1).max(1000) }),
    botao: z.object({ titulo: z.string().min(1).max(20) }).nullable().optional(),
    exigir_seguir: z
      .object({ texto: z.string().min(1), texto_nao_segue: z.string().optional(), botao: z.string().max(20).optional() })
      .nullable()
      .optional(),
    material: z.object({ texto: z.string().min(1).max(1000) }).nullable().optional(),
    link_url: z.string().url().nullable().optional(),
  })
  .superRefine((a, ctx) => {
    if (a.gatilho !== 'story' && !a.keywords.length)
      ctx.addIssue({ code: 'custom', message: 'Cadastre ao menos uma palavra-chave' });
    if (a.gatilho !== 'comentario' && (a.resposta_publica || a.exigir_seguir || a.material))
      ctx.addIssue({ code: 'custom', message: 'Resposta pública, "siga para receber" e material só valem para comentários' });
  });

function toForm(a) {
  const get = (tipo) => action(a, tipo)?.conteudo || null;
  return {
    id: a.id,
    account_id: a.account_id,
    nome: a.nome,
    gatilho: a.gatilho,
    escopo: a.escopo,
    media_ids: a.media_ids,
    post_id: a.post_id,
    ativo: a.ativo,
    keywords: a.keywords.map((k) => ({ palavra: k.palavra, modo: k.modo })),
    resposta_publica: get('resposta_publica'),
    dm: get('dm') || { texto: '' },
    botao: get('botao'),
    exigir_seguir: get('exigir_seguir'),
    material: get('material'),
    link_url: a.link?.url_destino || null,
    link: a.link,
  };
}

async function owned(userId, id) {
  const a = await loadAutomation(id);
  if (!a || !(await ownedAccount(userId, a.account_id))) throw new HttpError(404, 'Automação não encontrada');
  return a;
}

async function writeChildren(client, automationId, body) {
  await client.query(`DELETE FROM automation_keywords WHERE automation_id = $1`, [automationId]);
  await client.query(`DELETE FROM automation_actions WHERE automation_id = $1`, [automationId]);

  const seen = new Set();
  for (const k of body.keywords) {
    const palavra = normalize(k.palavra);
    if (!palavra || seen.has(palavra)) continue;
    seen.add(palavra);
    await client.query(`INSERT INTO automation_keywords (automation_id, palavra, modo) VALUES ($1, $2, $3)`, [
      automationId,
      palavra,
      k.modo,
    ]);
  }

  const actions = [
    ['resposta_publica', body.resposta_publica],
    ['exigir_seguir', body.exigir_seguir],
    ['dm', body.dm],
    ['botao', body.botao],
    ['material', body.material],
  ].filter(([, c]) => c);
  for (const [i, [tipo, conteudo]] of actions.entries()) {
    await client.query(`INSERT INTO automation_actions (automation_id, ordem, tipo, conteudo) VALUES ($1, $2, $3, $4)`, [
      automationId,
      i,
      tipo,
      JSON.stringify(conteudo),
    ]);
  }

  // Mantém o slug ao trocar o destino para não quebrar links já enviados
  const { rows } = await client.query(`SELECT id FROM links WHERE automation_id = $1 ORDER BY id LIMIT 1`, [automationId]);
  if (body.link_url && rows[0]) {
    await client.query(`UPDATE links SET url_destino = $2 WHERE id = $1`, [rows[0].id, body.link_url]);
  } else if (body.link_url) {
    await client.query(`INSERT INTO links (automation_id, url_destino, slug) VALUES ($1, $2, $3)`, [
      automationId,
      body.link_url,
      nanoid(8),
    ]);
  } else if (rows[0]) {
    await client.query(`UPDATE links SET automation_id = NULL WHERE id = $1`, [rows[0].id]);
  }
}

router.get(
  '/automations',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT a.id, a.account_id, a.nome, a.gatilho, a.escopo, a.ativo, a.criado_em, ac.username,
         (SELECT string_agg(k.palavra, ', ') FROM automation_keywords k WHERE k.automation_id = a.id) AS palavras,
         (SELECT count(*)::int FROM comment_events ce WHERE ce.automation_id = a.id) AS disparos,
         (SELECT COALESCE(sum(l.cliques), 0)::int FROM links l WHERE l.automation_id = a.id) AS cliques
       FROM automations a JOIN ig_accounts ac ON ac.id = a.account_id
       WHERE ac.user_id = $1 ORDER BY a.criado_em DESC`,
      [req.user.id],
    );
    res.json(rows);
  }),
);

router.get(
  '/automations/:id',
  asyncHandler(async (req, res) => res.json(toForm(await owned(req.user.id, req.params.id)))),
);

router.post(
  '/automations',
  asyncHandler(async (req, res) => {
    const body = schema.parse(req.body);
    if (!(await ownedAccount(req.user.id, body.account_id))) throw new HttpError(404, 'Conta não encontrada');
    const id = await transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO automations (account_id, nome, gatilho, escopo, media_ids, post_id, ativo)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [body.account_id, body.nome, body.gatilho, body.escopo, body.media_ids, body.post_id || null, body.ativo],
      );
      await writeChildren(client, rows[0].id, body);
      return rows[0].id;
    });
    res.status(201).json(toForm(await loadAutomation(id)));
  }),
);

router.put(
  '/automations/:id',
  asyncHandler(async (req, res) => {
    const existing = await owned(req.user.id, req.params.id);
    const body = schema.parse(req.body);
    if (!(await ownedAccount(req.user.id, body.account_id))) throw new HttpError(404, 'Conta não encontrada');
    await transaction(async (client) => {
      await client.query(
        `UPDATE automations SET account_id = $2, nome = $3, gatilho = $4, escopo = $5, media_ids = $6, post_id = $7, ativo = $8
         WHERE id = $1`,
        [existing.id, body.account_id, body.nome, body.gatilho, body.escopo, body.media_ids, body.post_id || null, body.ativo],
      );
      await writeChildren(client, existing.id, body);
    });
    res.json(toForm(await loadAutomation(existing.id)));
  }),
);

router.patch(
  '/automations/:id/toggle',
  asyncHandler(async (req, res) => {
    const existing = await owned(req.user.id, req.params.id);
    await query(`UPDATE automations SET ativo = NOT ativo WHERE id = $1`, [existing.id]);
    res.json({ ativo: !existing.ativo });
  }),
);

router.delete(
  '/automations/:id',
  asyncHandler(async (req, res) => {
    const existing = await owned(req.user.id, req.params.id);
    await query(`DELETE FROM automations WHERE id = $1`, [existing.id]);
    res.sendStatus(204);
  }),
);

export default router;
