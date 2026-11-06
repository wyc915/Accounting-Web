import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './db/index.js';
import multipart from '@fastify/multipart';
import { AUTH_COOKIE, authRoutes, registerAuthenticate } from './auth.js';
import { settingsRoutes } from './routes/settings.js';
import { MAX_FILE, attachmentRoutes } from './routes/attachments.js';
import { dataRoutes } from './routes/data.js';
import { accountRoutes } from './routes/accounts.js';
import { categoryRoutes } from './routes/categories.js';
import { transactionRoutes } from './routes/transactions.js';
import { statsRoutes } from './routes/stats.js';
import { processRecurring, recurringRoutes } from './routes/recurring.js';
import { extraRoutes } from './routes/extras.js';
import { HttpError } from './util.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

function jwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = resolve(DATA_DIR, '.jwt-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const s = randomBytes(48).toString('hex');
  writeFileSync(file, s, { mode: 0o600 });
  return s;
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 1024 * 1024 });

await app.register(cookie);
await app.register(jwt, { secret: jwtSecret(), cookie: { cookieName: AUTH_COOKIE, signed: false } });

await app.register(multipart, { limits: { fileSize: MAX_FILE, files: 1, fields: 5 } });

// session check + server-enforced PIN lock (423 when locked)
const { setUnlock } = registerAuthenticate(app);

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HttpError) return reply.code(err.statusCode).send({ message: err.message });
  const e = err as { statusCode?: number; message?: string };
  if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ message: e.message });
  app.log.error(err);
  reply.code(500).send({ message: '伺服器錯誤' });
});

await app.register(authRoutes, { setUnlock });
await app.register(accountRoutes);
await app.register(categoryRoutes);
await app.register(transactionRoutes);
await app.register(statsRoutes);
await app.register(recurringRoutes);
await app.register(extraRoutes);
await app.register(settingsRoutes);
await app.register(attachmentRoutes);
await app.register(dataRoutes);

// Post due recurring transactions on boot and every 15 minutes
const runRecurring = () => {
  try {
    const n = processRecurring();
    if (n) app.log.info(`recurring: created ${n} transaction(s)`);
  } catch (e) {
    app.log.error(e);
  }
};
runRecurring();
setInterval(runRecurring, 15 * 60_000).unref();

app.get('/api/health', async () => ({ ok: true }));

// Serve built frontend in production
const webDist = resolve(here, '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ message: 'Not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ port: PORT, host: HOST });
