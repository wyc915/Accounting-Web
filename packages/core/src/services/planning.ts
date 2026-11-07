import { addDays, addMonths, addWeeks, addYears, format, parseISO } from 'date-fns';
import {
  budgetInput, recurringInput, type Budget, type CategoryStat, type RecurringInput, type RecurringRule, type TrendPoint,
} from '@ledger/shared';
import type { Ctx } from '../ctx.js';
import { CoreError, fromCents, parse, stamp, toCents, today } from '../util.js';

const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
const range = (q: Record<string, unknown>) => {
  const from = String(q.from ?? '');
  const to = String(q.to ?? '');
  if (!ymdRe.test(from) || !ymdRe.test(to)) throw new CoreError(400, '需要 from / to 日期');
  return { from, to };
};

/* ============================== Stats & budgets ============================== */
export function statsService(ctx: Ctx) {
  const { sql } = ctx;
  return {
    async trend(q: Record<string, unknown>): Promise<TrendPoint[]> {
      const { from, to } = range(q);
      const len = q.unit === 'month' ? 7 : 10;
      const rows = await sql.all<TrendPoint>(
        `SELECT substr(occurred_at, 1, ${len}) key,
           SUM(CASE WHEN type = 'income' THEN base_amount ELSE 0 END) income,
           SUM(CASE WHEN type = 'expense' THEN base_amount ELSE 0 END) expense
         FROM transactions WHERE deleted_at IS NULL AND occurred_at >= ? AND occurred_at < ?
         GROUP BY key ORDER BY key`,
        [from, to],
      );
      return rows.map((r) => ({ key: r.key, income: fromCents(r.income), expense: fromCents(r.expense) }));
    },
    async categories(q: Record<string, unknown>): Promise<CategoryStat[]> {
      const { from, to } = range(q);
      const type = q.type === 'income' ? 'income' : 'expense';
      const parentId = Number(q.parentId) || null;
      const base = `FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.deleted_at IS NULL AND t.type = ? AND t.occurred_at >= ? AND t.occurred_at < ?`;
      const rows = parentId
        ? await sql.all<CategoryStat>(
            `SELECT t.category_id categoryId, SUM(t.base_amount) amount, COUNT(*) count ${base}
             AND (t.category_id = ? OR c.parent_id = ?) GROUP BY t.category_id ORDER BY amount DESC`,
            [type, from, to, parentId, parentId],
          )
        : await sql.all<CategoryStat>(
            `SELECT COALESCE(c.parent_id, c.id) categoryId, SUM(t.base_amount) amount, COUNT(*) count ${base} GROUP BY 1 ORDER BY amount DESC`,
            [type, from, to],
          );
      return rows.map((r) => ({ ...r, amount: fromCents(r.amount) }));
    },

    async budgets(month?: string): Promise<Budget[]> {
      const m = /^\d{4}-\d{2}$/.test(month ?? '') ? month! : format(new Date(), 'yyyy-MM');
      const start = parseISO(`${m}-01`);
      const from = format(start, 'yyyy-MM-dd');
      const to = format(addMonths(start, 1), 'yyyy-MM-dd');
      const rows = await sql.all<{ id: number; category_id: number | null; amount: number }>('SELECT * FROM budgets');
      const out: Budget[] = [];
      for (const b of rows) {
        const s =
          b.category_id == null
            ? await sql.get<{ s: number }>(
                `SELECT COALESCE(SUM(base_amount), 0) s FROM transactions WHERE deleted_at IS NULL AND type = 'expense' AND occurred_at >= ? AND occurred_at < ?`,
                [from, to],
              )
            : await sql.get<{ s: number }>(
                `SELECT COALESCE(SUM(t.base_amount), 0) s FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
                 WHERE t.deleted_at IS NULL AND t.type = 'expense' AND t.occurred_at >= ? AND t.occurred_at < ? AND (t.category_id = ? OR c.parent_id = ?)`,
                [from, to, b.category_id, b.category_id],
              );
        out.push({ id: b.id, categoryId: b.category_id, amount: fromCents(b.amount), spent: fromCents(s!.s) });
      }
      return out.sort((a, b) => (a.categoryId == null ? -1 : b.categoryId == null ? 1 : b.spent / b.amount - a.spent / a.amount));
    },
    async upsertBudget(body: unknown) {
      const b = parse(budgetInput, body);
      if (b.categoryId != null) await ctx.assertCategory(b.categoryId, 'expense');
      const exist = await sql.get<{ id: number }>('SELECT id FROM budgets WHERE COALESCE(category_id, 0) = ?', [b.categoryId ?? 0]);
      if (exist) await sql.run('UPDATE budgets SET amount = ? WHERE id = ?', [toCents(b.amount), exist.id]);
      else await sql.run('INSERT INTO budgets (category_id, amount) VALUES (?, ?)', [b.categoryId, toCents(b.amount)]);
      return { ok: true };
    },
    async removeBudget(id: number) {
      await sql.run('DELETE FROM budgets WHERE id = ?', [id]);
      return { ok: true };
    },
  };
}

/* ============================== Recurring ============================== */
type RuleRow = {
  id: number; type: string; amount: number; account_id: number; to_account_id: number | null; category_id: number | null;
  note: string; freq: string; interval: number; start_date: string; end_date: string | null; time: string;
  run_count: number; next_date: string | null; active: number;
};
const MAX_PER_RUN = 400;

/** n-th occurrence (0-based) computed from the start date — no month-end drift */
export function occurrence(r: { start_date: string; freq: string; interval: number }, n: number) {
  const s = parseISO(r.start_date);
  const k = n * r.interval;
  const d = r.freq === 'daily' ? addDays(s, k) : r.freq === 'weekly' ? addWeeks(s, k) : r.freq === 'monthly' ? addMonths(s, k) : addYears(s, k);
  return format(d, 'yyyy-MM-dd');
}
const nextOrNull = (r: RuleRow, n: number) => {
  const d = occurrence(r, n);
  return r.end_date && d > r.end_date ? null : d;
};
const ruleDto = (r: RuleRow): RecurringRule => ({
  id: r.id,
  type: r.type as RecurringRule['type'],
  amount: fromCents(r.amount),
  accountId: r.account_id,
  toAccountId: r.to_account_id,
  categoryId: r.category_id,
  note: r.note,
  freq: r.freq as RecurringRule['freq'],
  interval: r.interval,
  startDate: r.start_date,
  endDate: r.end_date,
  time: r.time,
  runCount: r.run_count,
  nextDate: r.next_date,
  active: !!r.active,
});

export function recurringService(ctx: Ctx) {
  const { sql } = ctx;

  /** post every due occurrence (called on launch / resume and after edits) */
  async function process() {
    const t = today();
    const due = (await sql.all<RuleRow>('SELECT * FROM recurring_rules WHERE active = 1 AND next_date IS NOT NULL AND next_date <= ?', [t]));
    let created = 0;
    for (const r of due) {
      const base = await ctx.toBase(r.account_id, r.amount, false);
      let toAmount: number | null = null;
      if (r.type === 'transfer' && r.to_account_id) toAmount = await ctx.convertBetween(r.account_id, r.to_account_id, r.amount).catch(() => r.amount);
      await sql.tx(async () => {
        let n = r.run_count;
        let next: string | null = r.next_date;
        let i = 0;
        while (next && next <= t && i < MAX_PER_RUN) {
          const now = stamp();
          await sql.run(
            `INSERT INTO transactions (type, amount, base_amount, account_id, to_account_id, to_amount, category_id, occurred_at, note, recurring_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [r.type, r.amount, base, r.account_id, r.to_account_id, toAmount, r.category_id, `${next}T${r.time}`, r.note, r.id, now, now],
          );
          created++;
          i++;
          n++;
          next = nextOrNull(r, n);
        }
        await sql.run('UPDATE recurring_rules SET run_count = ?, next_date = ? WHERE id = ?', [n, next, r.id]);
      });
    }
    return created;
  }

  async function validate(b: RecurringInput) {
    await ctx.assertAccount(b.accountId);
    if (b.type === 'transfer') {
      await ctx.assertAccount(b.toAccountId!);
      b.categoryId = null;
    } else {
      b.toAccountId = null;
      await ctx.assertCategory(b.categoryId!, b.type);
    }
  }
  const get = async (id: number) => {
    const r = await sql.get<RuleRow>('SELECT * FROM recurring_rules WHERE id = ?', [id]);
    if (!r) throw new CoreError(404, '規則不存在');
    return r;
  };

  return {
    process,
    async list() {
      await process();
      return (await sql.all<RuleRow>('SELECT * FROM recurring_rules ORDER BY next_date IS NULL, next_date, id')).map(ruleDto);
    },
    async create(body: unknown) {
      const b = parse(recurringInput, body);
      await validate(b);
      const id = await sql.insert(
        `INSERT INTO recurring_rules (type, amount, account_id, to_account_id, category_id, note, freq, interval, start_date, end_date, time, run_count, next_date, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [b.type, toCents(b.amount), b.accountId, b.toAccountId, b.categoryId, b.note, b.freq, b.interval, b.startDate, b.endDate, b.time,
          b.endDate && b.startDate > b.endDate ? null : b.startDate, b.active ? 1 : 0],
      );
      const created = await process();
      return { rule: ruleDto(await get(id)), created };
    },
    async update(id: number, body: unknown) {
      const cur = await get(id);
      const b = parse(recurringInput, body);
      await validate(b);
      const merged: RuleRow = { ...cur, start_date: b.startDate, end_date: b.endDate, freq: b.freq, interval: b.interval };
      // resume after the last generated occurrence so edits never duplicate history
      const last = (await sql.get<{ d: string | null }>(
        'SELECT MAX(substr(occurred_at, 1, 10)) d FROM transactions WHERE recurring_id = ? AND deleted_at IS NULL',
        [id],
      ))?.d ?? (cur.run_count > 0 ? occurrence(cur, cur.run_count - 1) : null);
      let n = 0;
      if (last) while (n < 100_000 && occurrence(merged, n) <= last) n++;
      await sql.run(
        `UPDATE recurring_rules SET type = ?, amount = ?, account_id = ?, to_account_id = ?, category_id = ?, note = ?, freq = ?, interval = ?,
           start_date = ?, end_date = ?, time = ?, active = ?, run_count = ?, next_date = ? WHERE id = ?`,
        [b.type, toCents(b.amount), b.accountId, b.toAccountId, b.categoryId, b.note, b.freq, b.interval, b.startDate, b.endDate, b.time,
          b.active ? 1 : 0, n, nextOrNull(merged, n), id],
      );
      const created = await process();
      return { rule: ruleDto(await get(id)), created };
    },
    async remove(id: number) {
      await sql.run('DELETE FROM recurring_rules WHERE id = ?', [id]);
      return { ok: true };
    },
  };
}
