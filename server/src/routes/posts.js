import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../lib/db.js';
import { asyncHandler, ownedAccount, HttpError } from '../lib/auth.js';
import { schedulePost, unschedulePost } from '../lib/queues.js';

const router = Router();

const mediaItem = z.object({ url: z.string().url(), kind: z.enum(['image', 'video']) });
const postSchema = z
  .object({
    account_id: z.coerce.number(),
    tipo: z.enum(['imagem', 'carrossel', 'reel', 'story']),
    legenda: z.string().max(2200).default(''),
    media_urls: z.array(mediaItem).min(1).max(10),
    agendado_para: z.coerce.date().nullable().optional(),
    rascunho: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    const kinds = p.media_urls.map((m) => m.kind);
    if (p.tipo === 'imagem' && (kinds.length !== 1 || kinds[0] !== 'image'))
      ctx.addIssue({ code: 'custom', message: 'Post de imagem leva exatamente 1 imagem' });
    if (p.tipo === 'reel' && (kinds.length !== 1 || kinds[0] !== 'video'))
      ctx.addIssue({ code: 'custom', message: 'Reel leva exatamente 1 vídeo' });
    if (p.tipo === 'story' && kinds.length !== 1) ctx.addIssue({ code: 'custom', message: 'Story leva 1 mídia' });
    if (p.tipo === 'carrossel' && kinds.length < 2) ctx.addIssue({ code: 'custom', message: 'Carrossel leva de 2 a 10 mídias' });
    if (!p.rascunho && !p.agendado_para) ctx.addIssue({ code: 'custom', message: 'Informe o horário de publicação' });
  });

async function ownedPost(userId, postId) {
  const post = await one(
    `SELECT p.* FROM posts p JOIN ig_accounts a ON a.id = p.account_id WHERE p.id = $1 AND a.user_id = $2`,
    [postId, userId],
  );
  if (!post) throw new HttpError(404, 'Post não encontrado');
  return post;
}

router.get(
  '/posts',
  asyncHandler(async (req, res) => {
    const params = [req.user.id];
    let filter = '';
    if (req.query.account_id) {
      params.push(req.query.account_id);
      filter = `AND p.account_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT p.*, a.username FROM posts p JOIN ig_accounts a ON a.id = p.account_id
       WHERE a.user_id = $1 ${filter}
       ORDER BY COALESCE(p.agendado_para, p.criado_em) DESC LIMIT 200`,
      params,
    );
    res.json(rows);
  }),
);

async function save(req, existing) {
  const body = postSchema.parse(req.body);
  if (!(await ownedAccount(req.user.id, body.account_id))) throw new HttpError(404, 'Conta não encontrada');
  const status = body.rascunho ? 'rascunho' : 'agendado';
  const values = [body.account_id, body.tipo, body.legenda, JSON.stringify(body.media_urls), body.agendado_para || null, status];

  const post = existing
    ? await one(
        `UPDATE posts SET account_id = $1, tipo = $2, legenda = $3, media_urls = $4, agendado_para = $5, status = $6, erro = NULL
         WHERE id = $7 RETURNING *`,
        [...values, existing.id],
      )
    : await one(
        `INSERT INTO posts (account_id, tipo, legenda, media_urls, agendado_para, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        values,
      );

  if (status === 'agendado') await schedulePost(post);
  else await unschedulePost(post.id);
  return post;
}

router.post('/posts', asyncHandler(async (req, res) => res.status(201).json(await save(req))));

router.put(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const existing = await ownedPost(req.user.id, req.params.id);
    if (['publicando', 'publicado'].includes(existing.status)) throw new HttpError(409, 'Post já publicado ou em publicação');
    res.json(await save(req, existing));
  }),
);

router.post(
  '/posts/:id/publish-now',
  asyncHandler(async (req, res) => {
    const existing = await ownedPost(req.user.id, req.params.id);
    if (['publicando', 'publicado'].includes(existing.status)) throw new HttpError(409, 'Post já publicado ou em publicação');
    const post = await one(`UPDATE posts SET status = 'agendado', agendado_para = now(), erro = NULL WHERE id = $1 RETURNING *`, [
      existing.id,
    ]);
    await schedulePost(post);
    res.json(post);
  }),
);

router.delete(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const existing = await ownedPost(req.user.id, req.params.id);
    if (existing.status === 'publicando') throw new HttpError(409, 'Post em publicação');
    await unschedulePost(existing.id);
    await query(`DELETE FROM posts WHERE id = $1`, [existing.id]);
    res.sendStatus(204);
  }),
);

export default router;
