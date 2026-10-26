import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import pinoHttp from 'pino-http';
import { ZodError } from 'zod';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { pool } from './lib/db.js';
import { requireAuth } from './lib/auth.js';
import { webhooksQueue, postsQueue, maintenanceQueue, sendQueue } from './lib/queues.js';
import { migrate } from './migrate.js';
import metaRoutes from './routes/meta.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import postRoutes from './routes/posts.js';
import automationRoutes from './routes/automations.js';
import reportRoutes from './routes/reports.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

// Guarda o corpo bruto para validar X-Hub-Signature-256
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => (req.rawBody = buf) }));
app.use(express.urlencoded({ extended: false }));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use(metaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, accountRoutes, postRoutes, automationRoutes, reportRoutes);

await migrate();

// Painel das filas (Bull Board) com basic auth
if (config.bullBoard.password) {
  const board = new ExpressAdapter();
  board.setBasePath('/admin/queues');
  const { rows } = await pool.query(`SELECT id FROM ig_accounts`).catch(() => ({ rows: [] }));
  const bb = createBullBoard({
    queues: [webhooksQueue, postsQueue, maintenanceQueue, ...rows.map((r) => sendQueue(r.id))].map((q) => new BullMQAdapter(q)),
    serverAdapter: board,
  });
  app.use(
    '/admin/queues',
    async (req, res, next) => {
      const [user, pass] = Buffer.from((req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString().split(':');
      if (user !== config.bullBoard.user || pass !== config.bullBoard.password) {
        return res.set('WWW-Authenticate', 'Basic realm="filas"').sendStatus(401);
      }
      // inclui filas de contas conectadas depois do boot
      const { rows: accounts } = await pool.query(`SELECT id FROM ig_accounts`);
      for (const a of accounts) bb.addQueue(new BullMQAdapter(sendQueue(a.id)));
      next();
    },
    board.getRouter(),
  );
}

// Mídia local (STORAGE_DRIVER=local) precisa ser pública para a Meta baixar
if (config.storage.driver === 'local') {
  app.use('/media', express.static(path.resolve(config.storage.localDir, 'media'), { maxAge: '7d', fallthrough: false }));
}

// Painel React compilado
const webDist = path.resolve(process.env.WEB_DIST || '../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|webhooks\/|oauth\/|admin\/|media\/|l\/).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues.map((i) => i.message).join('; '), issues: err.issues });
  }
  const status = err.status || 500;
  if (status >= 500) req.log.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erro interno' : err.message });
});

app.listen(config.port, () => logger.info({ port: config.port }, 'API no ar'));
