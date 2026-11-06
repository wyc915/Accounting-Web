import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { addMonths, format, parseISO } from 'date-fns';
import {
  CURRENCIES, baseCurrencyInput, installmentInput, rateInput, type Currency, type ExchangeRate, type InstallmentPlan,
} from '@ledger/shared';
import { db, fromCents, schema, sqlite, toCents } from '../db/index.js';
import { HttpError, idParam, parse } from '../util.js';
import { NOW_LOCAL, accountCurrency, baseCurrency, toBase } from '../currency.js';
import { assertAccount } from './accounts.js';
import { assertCategory } from './categories.js';
import { removeAttachmentFiles } from './attachments.js';

const { exchangeRates: rates, installmentPlans: plans, transactions: tx } = schema;

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /* ---------- Exchange rates ---------- */
  app.get('/api/rates', async (req): Promise<ExchangeRate[]> =>
    db
      .select()
      .from(rates)
      .where(eq(rates.userId, req.user.uid))
      .orderBy(asc(rates.currency))
      .all()
      .map((r) => ({ currency: r.currency as ExchangeRate['currency'], rate: r.rate, updatedAt: r.updatedAt })),
  );

  app.put('/api/rates', async (req) => {
    const uid = req.user.uid;
    const b = parse(rateInput, req.body);
    if (b.currency === baseCurrency(uid)) throw new HttpError(400, '主要幣別不需設定匯率');
    sqlite
      .prepare(
        `INSERT INTO exchange_rates (user_id, currency, rate, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, currency) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
      )
      .run(uid, b.currency, b.rate);
    return { ok: true };
  });

  app.delete('/api/rates/:currency', async (req) => {
    const uid = req.user.uid;
    const cur = String((req.params as { currency: string }).currency).toUpperCase();
    const used = (sqlite.prepare(`SELECT COUNT(*) c FROM accounts WHERE user_id = ? AND currency = ?`).get(uid, cur) as { c: number }).c;
    if (used) throw new HttpError(409, `仍有 ${used} 個帳戶使用 ${cur}，無法刪除匯率`);
    db.delete(rates).where(and(eq(rates.userId, uid), eq(rates.currency, cur))).run();
    return { ok: true };
  });

  /** change base currency — only while every account is still in the current base currency */
  app.put('/api/settings/base-currency', async (req) => {
    const uid = req.user.uid;
    const { baseCurrency: next } = parse(baseCurrencyInput, req.body);
    const cur = baseCurrency(uid);
    if (next === cur) return { ok: true };
    const foreign = (sqlite.prepare(`SELECT COUNT(*) c FROM accounts WHERE user_id = ? AND currency <> ?`).get(uid, cur) as { c: number }).c;
    if (foreign) throw new HttpError(409, '已有外幣帳戶時無法變更主要幣別');
    db.transaction(() => {
      sqlite.prepare(`UPDATE users SET base_currency = ? WHERE id = ?`).run(next, uid);
      sqlite.prepare(`UPDATE accounts SET currency = ? WHERE user_id = ?`).run(next, uid);
      sqlite.prepare(`DELETE FROM exchange_rates WHERE user_id = ?`).run(uid);
    });
    return { ok: true };
  });

  /* ---------- Installments ---------- */
  const planDto = (uid: number, p: typeof plans.$inferSelect): InstallmentPlan => {
    const s = sqlite
      .prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount),0) a FROM transactions
         WHERE user_id = ? AND installment_id = ? AND deleted_at IS NULL AND occurred_at <= ${NOW_LOCAL}`,
      )
      .get(uid, p.id) as { n: number; a: number };
    return {
      id: p.id,
      name: p.name,
      total: fromCents(p.total),
      periods: p.periods,
      accountId: p.accountId,
      categoryId: p.categoryId,
      startDate: p.startDate,
      posted: s.n,
      postedAmount: fromCents(s.a),
    };
  };

  app.get('/api/installments', async (req) => {
    const uid = req.user.uid;
    return db.select().from(plans).where(eq(plans.userId, uid)).orderBy(asc(plans.startDate)).all().map((p) => planDto(uid, p));
  });

  app.post('/api/installments', async (req) => {
    const uid = req.user.uid;
    const b = parse(installmentInput, req.body);
    assertAccount(uid, b.accountId);
    if (b.categoryId != null) assertCategory(uid, b.categoryId, 'expense');
    const total = toCents(b.total);
    // split in the currency's smallest unit (TWD/JPY → whole units); the remainder lands on the first period
    const digits = CURRENCIES[accountCurrency(uid, b.accountId) as Currency]?.digits ?? 2;
    const unit = digits === 0 ? 100 : 1;
    const per = Math.floor(total / unit / b.periods) * unit;
    const first = total - per * (b.periods - 1);
    const start = parseISO(b.startDate);
    const plan = db.transaction((t) => {
      const p = t
        .insert(plans)
        .values({ userId: uid, accountId: b.accountId, categoryId: b.categoryId, name: b.name, total, periods: b.periods, startDate: b.startDate })
        .returning()
        .get();
      for (let i = 0; i < b.periods; i++) {
        const amount = i === 0 ? first : per;
        t.insert(tx)
          .values({
            userId: uid,
            type: 'expense',
            amount,
            baseAmount: toBase(uid, b.accountId, amount),
            accountId: b.accountId,
            categoryId: b.categoryId,
            occurredAt: `${format(addMonths(start, i), 'yyyy-MM-dd')}T${b.time}`,
            note: `${b.name}（分期 ${i + 1}/${b.periods}）`,
            installmentId: p.id,
            installmentNo: i + 1,
          })
          .run();
      }
      return p;
    });
    return planDto(uid, plan);
  });

  /** mode=future (default): keep posted periods, remove future ones; mode=all: remove every period */
  app.delete('/api/installments/:id', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    const mode = (req.query as { mode?: string }).mode === 'all' ? 'all' : 'future';
    const p = db.select().from(plans).where(and(eq(plans.id, id), eq(plans.userId, uid))).get();
    if (!p) throw new HttpError(404, '分期不存在');
    const target = sqlite
      .prepare(`SELECT id FROM transactions WHERE user_id = ? AND installment_id = ? ${mode === 'future' ? `AND occurred_at > ${NOW_LOCAL}` : ''}`)
      .all(uid, id) as { id: number }[];
    db.transaction(() => {
      removeAttachmentFiles(uid, target.map((r) => r.id));
      if (target.length) sqlite.prepare(`DELETE FROM transactions WHERE id IN (${target.map(() => '?').join(',')})`).run(...target.map((r) => r.id));
      // detach kept (posted) periods so deleting the plan doesn't cascade to them
      sqlite.prepare(`UPDATE transactions SET installment_id = NULL WHERE installment_id = ?`).run(id);
      db.delete(plans).where(eq(plans.id, id)).run();
    });
    return { ok: true, removed: target.length };
  });
}
