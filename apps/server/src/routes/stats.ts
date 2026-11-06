import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { budgetInput, type Budget, type CategoryStat, type TrendPoint } from '@ledger/shared';
import { db, fromCents, schema, sqlite, toCents } from '../db/index.js';
import { HttpError, idParam, parse } from '../util.js';
import { assertCategory } from './categories.js';
import { addMonths, format, parse as parseDate } from 'date-fns';

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const range = (q: Record<string, string | undefined>) => {
  if (!q.from || !q.to || !ymd.test(q.from) || !ymd.test(q.to)) throw new HttpError(400, '需要 from / to 日期');
  return { from: q.from, to: q.to };
};

export async function statsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  /** income / expense per day or month */
  app.get('/api/stats/trend', async (req): Promise<TrendPoint[]> => {
    const q = req.query as Record<string, string | undefined>;
    const { from, to } = range(q);
    const len = q.unit === 'month' ? 7 : 10;
    const rows = sqlite
      .prepare(
        `SELECT substr(occurred_at, 1, ${len}) AS key,
           SUM(CASE WHEN type = 'income' THEN COALESCE(base_amount, amount) ELSE 0 END) AS income,
           SUM(CASE WHEN type = 'expense' THEN COALESCE(base_amount, amount) ELSE 0 END) AS expense
         FROM transactions
         WHERE user_id = ? AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at < ?
         GROUP BY key ORDER BY key`,
      )
      .all(req.user.uid, from, to) as TrendPoint[];
    return rows.map((r) => ({ key: r.key, income: fromCents(r.income), expense: fromCents(r.expense) }));
  });

  /** totals grouped by top-level category, or by children of parentId */
  app.get('/api/stats/categories', async (req): Promise<CategoryStat[]> => {
    const q = req.query as Record<string, string | undefined>;
    const { from, to } = range(q);
    const type = q.type === 'income' ? 'income' : 'expense';
    const parentId = Number(q.parentId) || null;
    const base = `FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.type = ? AND t.occurred_at >= ? AND t.occurred_at < ?`;
    const rows = parentId
      ? sqlite
          .prepare(`SELECT t.category_id AS categoryId, SUM(COALESCE(t.base_amount, t.amount)) AS amount, COUNT(*) AS count ${base}
            AND (t.category_id = ? OR c.parent_id = ?) GROUP BY t.category_id ORDER BY amount DESC`)
          .all(req.user.uid, type, from, to, parentId, parentId)
      : sqlite
          .prepare(`SELECT COALESCE(c.parent_id, c.id) AS categoryId, SUM(COALESCE(t.base_amount, t.amount)) AS amount, COUNT(*) AS count ${base}
            GROUP BY 1 ORDER BY amount DESC`)
          .all(req.user.uid, type, from, to);
    return (rows as CategoryStat[]).map((r) => ({ ...r, amount: fromCents(r.amount) }));
  });

  /* ---------- Budgets ---------- */
  app.get('/api/budgets', async (req): Promise<Budget[]> => {
    const q = req.query as Record<string, string | undefined>;
    const month = /^\d{4}-\d{2}$/.test(q.month ?? '') ? q.month! : format(new Date(), 'yyyy-MM');
    const start = parseDate(`${month}-01`, 'yyyy-MM-dd', new Date());
    const from = format(start, 'yyyy-MM-dd');
    const to = format(addMonths(start, 1), 'yyyy-MM-dd');
    const uid = req.user.uid;
    const rows = db.select().from(schema.budgets).where(eq(schema.budgets.userId, uid)).all();
    const spentTotal = sqlite.prepare(
      `SELECT COALESCE(SUM(COALESCE(base_amount, amount)),0) s FROM transactions WHERE user_id = ? AND deleted_at IS NULL AND type = 'expense' AND occurred_at >= ? AND occurred_at < ?`,
    );
    const spentCat = sqlite.prepare(
      `SELECT COALESCE(SUM(COALESCE(t.base_amount, t.amount)),0) s FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.type = 'expense' AND t.occurred_at >= ? AND t.occurred_at < ?
         AND (t.category_id = ? OR c.parent_id = ?)`,
    );
    return rows
      .map((b) => {
        const s =
          b.categoryId == null
            ? (spentTotal.get(uid, from, to) as { s: number }).s
            : (spentCat.get(uid, from, to, b.categoryId, b.categoryId) as { s: number }).s;
        return { id: b.id, categoryId: b.categoryId, amount: fromCents(b.amount), spent: fromCents(s) };
      })
      .sort((a, b) => (a.categoryId == null ? -1 : b.categoryId == null ? 1 : b.spent / b.amount - a.spent / a.amount));
  });

  /** upsert by category (null = total) */
  app.put('/api/budgets', async (req) => {
    const b = parse(budgetInput, req.body);
    const uid = req.user.uid;
    if (b.categoryId != null) assertCategory(uid, b.categoryId, 'expense');
    const exist = sqlite
      .prepare(`SELECT id FROM budgets WHERE user_id = ? AND COALESCE(category_id, 0) = ?`)
      .get(uid, b.categoryId ?? 0) as { id: number } | undefined;
    if (exist) db.update(schema.budgets).set({ amount: toCents(b.amount) }).where(eq(schema.budgets.id, exist.id)).run();
    else db.insert(schema.budgets).values({ userId: uid, categoryId: b.categoryId, amount: toCents(b.amount) }).run();
    return { ok: true };
  });

  app.delete('/api/budgets/:id', async (req) => {
    const id = idParam(req.params);
    db.delete(schema.budgets).where(and(eq(schema.budgets.id, id), eq(schema.budgets.userId, req.user.uid))).run();
    return { ok: true };
  });
}
