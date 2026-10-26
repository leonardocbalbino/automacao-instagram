import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one } from '../lib/db.js';
import { config } from '../config.js';
import { signToken, requireAuth, asyncHandler, HttpError } from '../lib/auth.js';

const router = Router();

const credentials = z.object({ email: z.string().email(), senha: z.string().min(8) });

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = credentials.extend({ nome: z.string().min(1) }).parse(req.body);
    // O primeiro usuário vira admin; depois disso o cadastro só abre com ALLOW_SIGNUP=true
    const { count } = await one('SELECT count(*)::int AS count FROM users');
    if (count > 0 && !config.allowSignup) throw new HttpError(403, 'Cadastro fechado');
    const exists = await one('SELECT id FROM users WHERE email = $1', [body.email.toLowerCase()]);
    if (exists) throw new HttpError(409, 'E-mail já cadastrado');
    const user = await one(
      `INSERT INTO users (nome, email, senha_hash, papel) VALUES ($1, $2, $3, $4) RETURNING id, nome, email, papel`,
      [body.nome, body.email.toLowerCase(), await bcrypt.hash(body.senha, 12), count === 0 ? 'admin' : 'membro'],
    );
    res.status(201).json({ token: signToken(user), user });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = credentials.parse(req.body);
    const user = await one('SELECT * FROM users WHERE email = $1', [body.email.toLowerCase()]);
    if (!user || !(await bcrypt.compare(body.senha, user.senha_hash))) throw new HttpError(401, 'E-mail ou senha inválidos');
    res.json({ token: signToken(user), user: { id: user.id, nome: user.nome, email: user.email, papel: user.papel } });
  }),
);

router.get(
  '/setup',
  asyncHandler(async (req, res) => {
    const { count } = await one('SELECT count(*)::int AS count FROM users');
    res.json({ needsSetup: count === 0, allowSignup: config.allowSignup });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await one('SELECT id, nome, email, papel FROM users WHERE id = $1', [req.user.id]));
  }),
);

export default router;
