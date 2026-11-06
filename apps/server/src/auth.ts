import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import {
  lockSettingsInput, loginSchema, passwordSchema, pinDisableInput, pinSetInput, pinVerifyInput, profileSchema, registerSchema,
  type User,
} from '@ledger/shared';
import { db, schema } from './db/index.js';
import { seedUser } from './seed.js';
import { processRecurring } from './routes/recurring.js';
import { parse } from './util.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { uid: number; kind?: 'unlock' };
    user: { uid: number; kind?: 'unlock' };
  }
}
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  }
  interface FastifyRequest {
    locked: boolean;
  }
  interface FastifyContextConfig {
    /** route stays reachable while the PIN lock is engaged */
    allowLocked?: boolean;
  }
}

export const AUTH_COOKIE = 'ledger_token';
const UNLOCK_COOKIE = 'ledger_unlock';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const cookieOpts = (maxAge: number) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  // enable when served over HTTPS (behind a reverse proxy etc.)
  secure: process.env.COOKIE_SECURE === '1',
  maxAge,
});

type UserRow = typeof schema.users.$inferSelect;
const publicUser = (u: UserRow, locked = false): User => ({
  id: u.id,
  name: u.name,
  email: u.email,
  baseCurrency: u.baseCurrency as User['baseCurrency'],
  pinEnabled: !!u.pinHash,
  lockMinutes: u.lockMinutes,
  locked,
});

/* ---------- lock state cache ---------- */
const lockCache = new Map<number, { pin: boolean; minutes: number }>();
function lockState(uid: number) {
  let s = lockCache.get(uid);
  if (!s) {
    const u = db.select({ pin: schema.users.pinHash, m: schema.users.lockMinutes }).from(schema.users).where(eq(schema.users.id, uid)).get();
    s = { pin: !!u?.pin, minutes: u?.m ?? 5 };
    lockCache.set(uid, s);
  }
  return s;
}
const invalidateLock = (uid: number) => lockCache.delete(uid);

/** Installs `app.authenticate`: valid session cookie + (when a PIN is set) a sliding unlock cookie */
export function registerAuthenticate(app: FastifyInstance) {
  app.decorateRequest('locked', false);

  const setUnlock = (reply: FastifyReply, uid: number, minutes: number) => {
    const token = app.jwt.sign({ uid, kind: 'unlock' }, { expiresIn: minutes * 60 });
    reply.setCookie(UNLOCK_COOKIE, token, cookieOpts(minutes * 60));
  };
  const isUnlocked = (req: FastifyRequest, uid: number) => {
    const raw = req.cookies[UNLOCK_COOKIE];
    if (!raw) return false;
    try {
      const p = app.jwt.verify<{ uid: number; kind?: string }>(raw);
      return p.kind === 'unlock' && p.uid === uid;
    } catch {
      return false;
    }
  };

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ message: '未登入或登入已過期' });
    }
    if (req.user.kind) return reply.code(401).send({ message: '未登入或登入已過期' });
    const st = lockState(req.user.uid);
    if (!st.pin) return;
    if (isUnlocked(req, req.user.uid)) {
      setUnlock(reply, req.user.uid, st.minutes); // sliding expiry
      return;
    }
    req.locked = true;
    if (req.routeOptions.config?.allowLocked) return;
    return reply.code(423).send({ message: '已鎖定，請輸入 PIN', locked: true });
  });

  return { setUnlock };
}

export async function authRoutes(app: FastifyInstance, opts: { setUnlock: (r: FastifyReply, uid: number, m: number) => void }) {
  const { setUnlock } = opts;
  const setSession = (reply: FastifyReply, user: UserRow) => {
    reply.setCookie(AUTH_COOKIE, app.jwt.sign({ uid: user.id }, { expiresIn: MAX_AGE }), cookieOpts(MAX_AGE));
    // a password login also unlocks the PIN lock
    if (user.pinHash) setUnlock(reply, user.id, user.lockMinutes);
  };
  const getUser = (uid: number) => db.select().from(schema.users).where(eq(schema.users.id, uid)).get();

  // In-memory brute-force guards
  const attempts = new Map<string, { n: number; until: number }>();
  const pinAttempts = new Map<number, { n: number; until: number }>();

  app.post('/api/auth/register', async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const exists = db.select().from(schema.users).where(eq(schema.users.email, body.email)).get();
    if (exists) return reply.code(409).send({ message: '此 Email 已被註冊' });
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = db.insert(schema.users).values({ email: body.email, name: body.name, passwordHash }).returning().get();
    seedUser(user.id);
    setSession(reply, user);
    return publicUser(user);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const key = `${req.ip}|${body.email}`;
    const a = attempts.get(key);
    if (a && a.until > Date.now()) return reply.code(429).send({ message: '嘗試次數過多，請稍後再試' });
    const user = db.select().from(schema.users).where(eq(schema.users.email, body.email)).get();
    const ok = user && (await bcrypt.compare(body.password, user.passwordHash));
    if (!ok) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
      return reply.code(401).send({ message: 'Email 或密碼錯誤' });
    }
    attempts.delete(key);
    setSession(reply, user);
    return publicUser(user);
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(AUTH_COOKIE, { path: '/' });
    reply.clearCookie(UNLOCK_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate, config: { allowLocked: true } }, async (req, reply) => {
    const user = getUser(req.user.uid);
    if (!user) return reply.code(401).send({ message: '未登入' });
    if (!req.locked) processRecurring(user.id);
    return publicUser(user, req.locked);
  });

  /** keeps the sliding unlock alive while the user is active */
  app.post('/api/auth/ping', { preHandler: app.authenticate }, async () => ({ ok: true }));

  app.patch('/api/auth/me', { preHandler: app.authenticate }, async (req) => {
    const body = parse(profileSchema, req.body);
    const user = db.update(schema.users).set(body).where(eq(schema.users.id, req.user.uid)).returning().get();
    return publicUser(user!);
  });

  app.post('/api/auth/password', { preHandler: app.authenticate }, async (req, reply) => {
    const body = parse(passwordSchema, req.body);
    const user = getUser(req.user.uid);
    if (!user || !(await bcrypt.compare(body.current, user.passwordHash))) return reply.code(400).send({ message: '目前密碼不正確' });
    const passwordHash = await bcrypt.hash(body.next, 10);
    db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id)).run();
    return { ok: true };
  });

  /* ---------- PIN lock ---------- */
  app.post('/api/auth/pin', { preHandler: app.authenticate }, async (req, reply) => {
    const body = parse(pinSetInput, req.body);
    const user = getUser(req.user.uid)!;
    if (!(await bcrypt.compare(body.password, user.passwordHash))) return reply.code(400).send({ message: '登入密碼不正確' });
    const pinHash = await bcrypt.hash(body.pin, 10);
    db.update(schema.users).set({ pinHash }).where(eq(schema.users.id, user.id)).run();
    invalidateLock(user.id);
    setUnlock(reply, user.id, user.lockMinutes);
    return publicUser({ ...user, pinHash });
  });

  app.delete('/api/auth/pin', { preHandler: app.authenticate }, async (req, reply) => {
    const body = parse(pinDisableInput, req.body);
    const user = getUser(req.user.uid)!;
    if (!(await bcrypt.compare(body.password, user.passwordHash))) return reply.code(400).send({ message: '登入密碼不正確' });
    db.update(schema.users).set({ pinHash: null }).where(eq(schema.users.id, user.id)).run();
    invalidateLock(user.id);
    reply.clearCookie(UNLOCK_COOKIE, { path: '/' });
    return publicUser({ ...user, pinHash: null });
  });

  app.post('/api/auth/pin/verify', { preHandler: app.authenticate, config: { allowLocked: true } }, async (req, reply) => {
    const { pin } = parse(pinVerifyInput, req.body);
    const uid = req.user.uid;
    const a = pinAttempts.get(uid);
    if (a && a.until > Date.now()) {
      const s = Math.ceil((a.until - Date.now()) / 1000);
      return reply.code(429).send({ message: `嘗試次數過多，請 ${s} 秒後再試`, retryAfter: s });
    }
    const user = getUser(uid)!;
    if (!user.pinHash) return { ok: true };
    if (!(await bcrypt.compare(pin, user.pinHash))) {
      const n = (a?.n ?? 0) + 1;
      pinAttempts.set(uid, { n, until: n % 5 === 0 ? Date.now() + 5 * 60_000 : 0 });
      return reply.code(400).send({ message: n % 5 === 0 ? 'PIN 錯誤次數過多，已鎖定 5 分鐘' : `PIN 錯誤（剩 ${5 - (n % 5)} 次）` });
    }
    pinAttempts.delete(uid);
    setUnlock(reply, uid, user.lockMinutes);
    return { ok: true };
  });

  app.post('/api/auth/lock', { preHandler: app.authenticate, config: { allowLocked: true } }, async (_req, reply) => {
    reply.clearCookie(UNLOCK_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.put('/api/auth/lock-settings', { preHandler: app.authenticate }, async (req, reply) => {
    const { lockMinutes } = parse(lockSettingsInput, req.body);
    const user = db.update(schema.users).set({ lockMinutes }).where(eq(schema.users.id, req.user.uid)).returning().get()!;
    invalidateLock(user.id);
    if (user.pinHash) setUnlock(reply, user.id, lockMinutes);
    return publicUser(user);
  });
}
