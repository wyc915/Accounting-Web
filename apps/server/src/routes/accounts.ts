import type { FastifyInstance } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { addDays, addMonths, format, getDaysInMonth, setDate, startOfDay } from 'date-fns';
import { accountInput, reorderInput, type Account, type CardCycle } from '@ledger/shared';
import { db, fromCents, schema, sqlite, toCents } from '../db/index.js';
import { HttpError, idParam, parse } from '../util.js';
import { NOW_LOCAL, baseCurrency, rateOf } from '../currency.js';
import { removeAttachmentFiles } from './attachments.js';

const { accounts } = schema;

/** balances only count records up to now (future-dated items such as installments post on their date) */
const balanceStmt = sqlite.prepare(`
  SELECT a.id,
    a.initial_balance
    + COALESCE((SELECT SUM(CASE t.type WHEN 'income' THEN t.amount ELSE -t.amount END)
        FROM transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.occurred_at <= ${NOW_LOCAL}), 0)
    + COALESCE((SELECT SUM(COALESCE(t.to_amount, t.amount)) FROM transactions t
        WHERE t.to_account_id = a.id AND t.type = 'transfer' AND t.deleted_at IS NULL AND t.occurred_at <= ${NOW_LOCAL}), 0) AS balance,
    (SELECT COUNT(*) FROM transactions t
       WHERE (t.account_id = a.id OR t.to_account_id = a.id) AND t.deleted_at IS NULL) AS txCount
  FROM accounts a WHERE a.user_id = ?
`);

export function listAccounts(userId: number): Account[] {
  const rows = db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.sort), asc(accounts.id)).all();
  const bal = new Map((balanceStmt.all(userId) as { id: number; balance: number; txCount: number }[]).map((r) => [r.id, r]));
  return rows.map((r) => {
    const balance = bal.get(r.id)?.balance ?? r.initialBalance;
    return {
      id: r.id,
      name: r.name,
      type: r.type as Account['type'],
      icon: r.icon,
      color: r.color,
      initialBalance: fromCents(r.initialBalance),
      includeInTotal: r.includeInTotal,
      sort: r.sort,
      balance: fromCents(balance),
      baseBalance: fromCents(Math.round(balance * rateOf(userId, r.currency, false))),
      txCount: bal.get(r.id)?.txCount ?? 0,
      currency: r.currency as Account['currency'],
      statementDay: r.statementDay,
      dueDay: r.dueDay,
    };
  });
}

export function assertAccount(userId: number, id: number) {
  const a = db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, userId))).get();
  if (!a) throw new HttpError(400, '帳戶不存在');
}

/* ---------- Credit card cycle ---------- */
const dayIn = (d: Date, day: number) => setDate(d, Math.min(day, getDaysInMonth(d)));
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

export function cardCycle(uid: number, acc: typeof accounts.$inferSelect): CardCycle {
  const S = acc.statementDay ?? 1;
  const today = startOfDay(new Date());
  let lastClose = dayIn(today, S);
  if (lastClose > today) lastClose = dayIn(addMonths(today, -1), S);
  const prevClose = dayIn(addMonths(lastClose, -1), S);
  const nextClose = dayIn(addMonths(lastClose, 1), S);
  // transactions on the closing day belong to that statement → period is (prevClose, lastClose]
  const pFrom = ymd(addDays(prevClose, 1));
  const pTo = ymd(addDays(lastClose, 1));
  const charges = sqlite.prepare(`
    SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN -amount ELSE amount END), 0) s FROM transactions
    WHERE user_id = ? AND account_id = ? AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at < ?`);
  const payments = sqlite.prepare(`
    SELECT COALESCE(SUM(COALESCE(to_amount, amount)), 0) s FROM transactions
    WHERE user_id = ? AND to_account_id = ? AND type = 'transfer' AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ${NOW_LOCAL}`);
  const statement = (charges.get(uid, acc.id, pFrom, pTo) as { s: number }).s;
  const unbilled = (
    sqlite
      .prepare(`SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN -amount ELSE amount END), 0) s FROM transactions
        WHERE user_id = ? AND account_id = ? AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ${NOW_LOCAL}`)
      .get(uid, acc.id, pTo) as { s: number }
  ).s;
  const paid = (payments.get(uid, acc.id, pTo) as { s: number }).s;
  const instRemain = (
    sqlite
      .prepare(`SELECT COALESCE(SUM(amount), 0) s FROM transactions
        WHERE user_id = ? AND account_id = ? AND installment_id IS NOT NULL AND deleted_at IS NULL AND occurred_at > ${NOW_LOCAL}`)
      .get(uid, acc.id) as { s: number }
  ).s;
  let due: Date | null = null;
  if (acc.dueDay) {
    due = dayIn(lastClose, acc.dueDay);
    if (due <= lastClose) due = dayIn(addMonths(lastClose, 1), acc.dueDay);
  }
  return {
    accountId: acc.id,
    lastClose: ymd(lastClose),
    prevClose: ymd(prevClose),
    nextClose: ymd(nextClose),
    statementAmount: fromCents(statement),
    paid: fromCents(paid),
    dueDate: due ? ymd(due) : null,
    unbilled: fromCents(unbilled),
    installmentRemaining: fromCents(instRemain),
  };
}

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/accounts', async (req) => listAccounts(req.user.uid));

  app.get('/api/accounts/:id/cycle', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    const acc = db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, uid))).get();
    if (!acc) throw new HttpError(404, '帳戶不存在');
    return cardCycle(uid, acc);
  });

  app.post('/api/accounts', async (req) => {
    const b = parse(accountInput, req.body);
    const uid = req.user.uid;
    const currency = b.currency ?? baseCurrency(uid);
    rateOf(uid, currency); // require a rate for foreign accounts
    const max = db.select({ m: sql<number>`COALESCE(MAX(${accounts.sort}), -1)` }).from(accounts).where(eq(accounts.userId, uid)).get();
    const row = db
      .insert(accounts)
      .values({ ...b, currency, userId: uid, initialBalance: toCents(b.initialBalance), sort: (max?.m ?? -1) + 1 })
      .returning()
      .get();
    return listAccounts(uid).find((a) => a.id === row.id);
  });

  app.put('/api/accounts/:id', async (req) => {
    const id = idParam(req.params);
    const b = parse(accountInput, req.body);
    const uid = req.user.uid;
    const cur = db.select().from(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, uid))).get();
    if (!cur) throw new HttpError(404, '帳戶不存在');
    const currency = b.currency ?? cur.currency;
    if (currency !== cur.currency) {
      const n = (sqlite.prepare(`SELECT COUNT(*) c FROM transactions WHERE account_id = ? OR to_account_id = ?`).get(id, id) as { c: number }).c;
      if (n > 0) throw new HttpError(409, '此帳戶已有紀錄，無法變更幣別');
      rateOf(uid, currency);
    }
    db.update(accounts)
      .set({ ...b, currency, initialBalance: toCents(b.initialBalance) })
      .where(and(eq(accounts.id, id), eq(accounts.userId, uid)))
      .run();
    return listAccounts(uid).find((a) => a.id === id);
  });

  app.put('/api/accounts/reorder', async (req) => {
    const { ids } = parse(reorderInput, req.body);
    const uid = req.user.uid;
    db.transaction((tx) => {
      ids.forEach((id, i) => tx.update(accounts).set({ sort: i }).where(and(eq(accounts.id, id), eq(accounts.userId, uid))).run());
    });
    return { ok: true };
  });

  app.delete('/api/accounts/:id', async (req) => {
    const id = idParam(req.params);
    const uid = req.user.uid;
    assertAccount(uid, id);
    const live = sqlite
      .prepare(`SELECT COUNT(*) c FROM transactions WHERE user_id = ? AND deleted_at IS NULL AND (account_id = ? OR to_account_id = ?)`)
      .get(uid, id, id) as { c: number };
    if (live.c > 0) throw new HttpError(409, `此帳戶仍有 ${live.c} 筆紀錄，請先刪除或移轉紀錄`);
    // purge soft-deleted rows (and their photos) referencing this account
    const dead = sqlite
      .prepare(`SELECT id FROM transactions WHERE user_id = ? AND (account_id = ? OR to_account_id = ?)`)
      .all(uid, id, id) as { id: number }[];
    removeAttachmentFiles(uid, dead.map((d) => d.id));
    sqlite.prepare(`DELETE FROM transactions WHERE user_id = ? AND (account_id = ? OR to_account_id = ?)`).run(uid, id, id);
    sqlite.prepare(`DELETE FROM installment_plans WHERE user_id = ? AND account_id = ?`).run(uid, id);
    db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.userId, uid))).run();
    return { ok: true };
  });
}
