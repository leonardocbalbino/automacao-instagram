import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from './db.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), papel: user.papel }, config.jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: Number(payload.sub), papel: payload.papel };
    next();
  } catch {
    res.status(401).json({ error: 'Sessão inválida ou expirada' });
  }
}

// Garante que a conta do Instagram pertence ao usuário logado
export async function ownedAccount(userId, accountId) {
  return one(`SELECT * FROM ig_accounts WHERE id = $1 AND user_id = $2`, [accountId, userId]);
}

// Envolve handlers async para erros chegarem ao middleware de erro
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
