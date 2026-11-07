import { addDays, addMonths, getDaysInMonth, setDate, startOfDay } from 'date-fns';
import {
  accountInput, categoryInput, reorderInput, tagInput, type Account, type CardCycle, type Category, type Tag,
} from '@ledger/shared';
import type { Ctx } from '../ctx.js';
import { CoreError, fromCents, nowLocal, parse, stamp, toCents, ymd } from '../util.js';

type AccRow = {
  id: number; name: string; type: string; icon: string; color: string; currency: string; initial_balance: number;
  include_in_total: number; statement_day: number | null; due_day: number | null; sort: number;
};

export function accountsService(ctx: Ctx) {
  const { sql } = ctx;

  /** balances count only records up to now (future installments post on their date) */
  async function list(): Promise<Account[]> {
    const now = nowLocal();
    const rows = await sql.all<AccRow & { balance: number; tx_count: number }>(
      `SELECT a.*,
        a.initial_balance
        + COALESCE((SELECT SUM(CASE t.type WHEN 'income' THEN t.amount ELSE -t.amount END)
            FROM transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.occurred_at <= ?), 0)
        + COALESCE((SELECT SUM(COALESCE(t.to_amount, t.amount)) FROM transactions t
            WHERE t.to_account_id = a.id AND t.type = 'transfer' AND t.deleted_at IS NULL AND t.occurred_at <= ?), 0) AS balance,
        (SELECT COUNT(*) FROM transactions t WHERE (t.account_id = a.id OR t.to_account_id = a.id) AND t.deleted_at IS NULL) AS tx_count
       FROM accounts a ORDER BY a.sort, a.id`,
      [now, now],
    );
    const out: Account[] = [];
    for (const r of rows)
      out.push({
        id: r.id,
        name: r.name,
        type: r.type as Account['type'],
        icon: r.icon,
        color: r.color,
        currency: r.currency as Account['currency'],
        initialBalance: fromCents(r.initial_balance),
        includeInTotal: !!r.include_in_total,
        sort: r.sort,
        balance: fromCents(r.balance),
        baseBalance: fromCents(Math.round(r.balance * (await ctx.rateOf(r.currency, false)))),
        txCount: r.tx_count,
        statementDay: r.statement_day,
        dueDay: r.due_day,
      });
    return out;
  }
  const one = async (id: number) => (await list()).find((a) => a.id === id)!;

  /* ---------- credit card cycle ---------- */
  const dayIn = (d: Date, day: number) => setDate(d, Math.min(day, getDaysInMonth(d)));
  async function cycle(id: number): Promise<CardCycle> {
    const acc = await sql.get<AccRow>('SELECT * FROM accounts WHERE id = ?', [id]);
    if (!acc) throw new CoreError(404, '帳戶不存在');
    const S = acc.statement_day ?? 1;
    const today = startOfDay(new Date());
    let lastClose = dayIn(today, S);
    if (lastClose > today) lastClose = dayIn(addMonths(today, -1), S);
    const prevClose = dayIn(addMonths(lastClose, -1), S);
    const nextClose = dayIn(addMonths(lastClose, 1), S);
    const pFrom = ymd(addDays(prevClose, 1));
    const pTo = ymd(addDays(lastClose, 1));
    const now = nowLocal();
    const charge = `COALESCE(SUM(CASE WHEN type = 'income' THEN -amount ELSE amount END), 0)`;
    const statement = (await sql.get<{ s: number }>(`SELECT ${charge} s FROM transactions WHERE account_id = ? AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at < ?`, [id, pFrom, pTo]))!.s;
    const unbilled = (await sql.get<{ s: number }>(`SELECT ${charge} s FROM transactions WHERE account_id = ? AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?`, [id, pTo, now]))!.s;
    const paid = (await sql.get<{ s: number }>(
      `SELECT COALESCE(SUM(COALESCE(to_amount, amount)), 0) s FROM transactions WHERE to_account_id = ? AND type = 'transfer' AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at <= ?`,
      [id, pTo, now],
    ))!.s;
    const inst = (await sql.get<{ s: number }>(
      `SELECT COALESCE(SUM(amount), 0) s FROM transactions WHERE account_id = ? AND installment_id IS NOT NULL AND deleted_at IS NULL AND occurred_at > ?`,
      [id, now],
    ))!.s;
    let due: Date | null = null;
    if (acc.due_day) {
      due = dayIn(lastClose, acc.due_day);
      if (due <= lastClose) due = dayIn(addMonths(lastClose, 1), acc.due_day);
    }
    return {
      accountId: id,
      lastClose: ymd(lastClose),
      prevClose: ymd(prevClose),
      nextClose: ymd(nextClose),
      statementAmount: fromCents(statement),
      paid: fromCents(paid),
      dueDate: due ? ymd(due) : null,
      unbilled: fromCents(unbilled),
      installmentRemaining: fromCents(inst),
    };
  }

  return {
    list,
    cycle,
    async create(body: unknown) {
      const b = parse(accountInput, body);
      const currency = b.currency ?? (await ctx.baseCurrency());
      await ctx.rateOf(currency);
      const max = await sql.get<{ m: number }>('SELECT COALESCE(MAX(sort), -1) m FROM accounts');
      const id = await sql.insert(
        `INSERT INTO accounts (name, type, icon, color, currency, initial_balance, include_in_total, statement_day, due_day, sort, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.name, b.type, b.icon, b.color, currency, toCents(b.initialBalance), b.includeInTotal ? 1 : 0, b.statementDay, b.dueDay, (max?.m ?? -1) + 1, stamp()],
      );
      return one(id);
    },
    async update(id: number, body: unknown) {
      const b = parse(accountInput, body);
      const cur = await sql.get<AccRow>('SELECT * FROM accounts WHERE id = ?', [id]);
      if (!cur) throw new CoreError(404, '帳戶不存在');
      const currency = b.currency ?? cur.currency;
      if (currency !== cur.currency) {
        const n = await sql.get<{ c: number }>('SELECT COUNT(*) c FROM transactions WHERE account_id = ? OR to_account_id = ?', [id, id]);
        if (n?.c) throw new CoreError(409, '此帳戶已有紀錄，無法變更幣別');
        await ctx.rateOf(currency);
      }
      await sql.run(
        `UPDATE accounts SET name = ?, type = ?, icon = ?, color = ?, currency = ?, initial_balance = ?, include_in_total = ?, statement_day = ?, due_day = ? WHERE id = ?`,
        [b.name, b.type, b.icon, b.color, currency, toCents(b.initialBalance), b.includeInTotal ? 1 : 0, b.statementDay, b.dueDay, id],
      );
      return one(id);
    },
    async reorder(body: unknown) {
      const { ids } = parse(reorderInput, body);
      await sql.tx(async () => {
        for (const [i, id] of ids.entries()) await sql.run('UPDATE accounts SET sort = ? WHERE id = ?', [i, id]);
      });
      return { ok: true };
    },
    async remove(id: number) {
      await ctx.assertAccount(id);
      const live = await sql.get<{ c: number }>('SELECT COUNT(*) c FROM transactions WHERE deleted_at IS NULL AND (account_id = ? OR to_account_id = ?)', [id, id]);
      if (live?.c) throw new CoreError(409, `此帳戶仍有 ${live.c} 筆紀錄，請先刪除或移轉紀錄`);
      await sql.tx(async () => {
        await sql.run('DELETE FROM transactions WHERE account_id = ? OR to_account_id = ?', [id, id]);
        await sql.run('DELETE FROM installment_plans WHERE account_id = ?', [id]);
        await sql.run('DELETE FROM accounts WHERE id = ?', [id]);
      });
      return { ok: true };
    },
  };
}

/* ============================== Categories & tags ============================== */
type CatRow = { id: number; parent_id: number | null; type: string; name: string; icon: string; color: string; sort: number };
const catDto = (r: CatRow): Category => ({
  id: r.id,
  name: r.name,
  type: r.type as Category['type'],
  icon: r.icon,
  color: r.color,
  parentId: r.parent_id,
  sort: r.sort,
});

export function categoriesService(ctx: Ctx) {
  const { sql } = ctx;
  const owned = async (id: number) => {
    const c = await sql.get<CatRow>('SELECT * FROM categories WHERE id = ?', [id]);
    if (!c) throw new CoreError(404, '類別不存在');
    return c;
  };
  return {
    async list() {
      return (await sql.all<CatRow>('SELECT * FROM categories ORDER BY sort, id')).map(catDto);
    },
    async create(body: unknown) {
      const b = parse(categoryInput, body);
      if (b.parentId != null) {
        const p = await owned(b.parentId);
        if (p.parent_id != null) throw new CoreError(400, '子類別下不可再建立子類別');
        if (p.type !== b.type) throw new CoreError(400, '子類別需與父類別同類型');
      }
      const max = await sql.get<{ m: number }>('SELECT COALESCE(MAX(sort), -1) m FROM categories');
      const id = await sql.insert('INSERT INTO categories (parent_id, type, name, icon, color, sort) VALUES (?, ?, ?, ?, ?, ?)', [
        b.parentId, b.type, b.name, b.icon, b.color, (max?.m ?? -1) + 1,
      ]);
      return catDto((await owned(id))!);
    },
    async update(id: number, body: unknown) {
      await owned(id);
      const b = parse(categoryInput, body);
      await sql.run('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?', [b.name, b.icon, b.color, id]);
      return catDto(await owned(id));
    },
    async reorder(body: unknown) {
      const { ids } = parse(reorderInput, body);
      await sql.tx(async () => {
        for (const [i, id] of ids.entries()) await sql.run('UPDATE categories SET sort = ? WHERE id = ?', [i, id]);
      });
      return { ok: true };
    },
    async remove(id: number) {
      await owned(id);
      await sql.run('DELETE FROM categories WHERE id = ?', [id]);
      return { ok: true };
    },

    async tags(): Promise<Tag[]> {
      return sql.all<Tag>('SELECT id, name, color FROM tags ORDER BY name');
    },
    async createTag(body: unknown): Promise<Tag> {
      const b = parse(tagInput, body);
      const exist = await sql.get<Tag>('SELECT id, name, color FROM tags WHERE name = ?', [b.name]);
      if (exist) return exist;
      const id = await sql.insert('INSERT INTO tags (name, color) VALUES (?, ?)', [b.name, b.color]);
      return { id, name: b.name, color: b.color };
    },
    async removeTag(id: number) {
      await sql.run('DELETE FROM tags WHERE id = ?', [id]);
      return { ok: true };
    },
  };
}
