import { Router } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { config } from '../config.js';
import { query } from '../lib/db.js';
import { authorizeUrl } from '../lib/graph.js';
import { asyncHandler, HttpError } from '../lib/auth.js';
import { saveMedia, ALLOWED_MIME } from '../lib/storage.js';

const router = Router();

router.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const { rows } = await query(
      `SELECT id, ig_user_id, username, token_expira_em, status, criado_em FROM ig_accounts
       WHERE user_id = $1 ORDER BY username`,
      [req.user.id],
    );
    res.json(rows);
  }),
);

router.get('/accounts/connect-url', (req, res) => {
  if (!config.meta.appId || !config.meta.appSecret) throw new HttpError(500, 'IG_APP_ID/IG_APP_SECRET não configurados');
  const state = jwt.sign({ sub: String(req.user.id) }, config.jwtSecret, { expiresIn: '15m' });
  res.json({ url: authorizeUrl(state) });
});

router.delete(
  '/accounts/:id',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query(`DELETE FROM ig_accounts WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Conta não encontrada');
    res.sendStatus(204);
  }),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 300 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
});

router.post(
  '/uploads',
  upload.array('files', 10),
  asyncHandler(async (req, res) => {
    if (!req.files?.length) throw new HttpError(400, 'Envie arquivos JPEG, PNG, MP4 ou MOV');
    const saved = [];
    for (const file of req.files) saved.push(await saveMedia(file.buffer, file.mimetype));
    res.status(201).json(saved);
  }),
);

export default router;
