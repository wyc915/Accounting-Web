import { addMonths, format, parseISO } from 'date-fns';
import {
  CURRENCIES, goalEntryInput, goalInput, installmentInput, reorderInput, templateInput, type Currency, type Goal, type GoalEntry,
  type InstallmentPlan, type Template, type TemplateInput,
} from '@ledger/shared';
import type { Ctx } from '../ctx.js';
import { CoreError, fromCents, nowLocal, parse, stamp, toCents } from '../util.js';

/* ============================== Templates ============================== */
type TplRow = { id: number; name: string; type: string; amount: number | null; account_id: number | null; to_account_id: number | null; category_id: number | null; note: string; sort: number };
const tplDto = (r: TplRow): Template => ({
  id: r.id,
  name: r.name,
  type: r.type as Template['type'],
  amount: r.amount == null ? null : fromCents(r.amount),
  accountId: r.account_id,
  toAccountId: r.to_account_id,
  categoryId: r.category_id,
  note: r.note,
  sort: r.sort,
});

export function templatesService(ctx: Ctx) {
  const { sql } = ctx;
  async function validate(b: TemplateInput) {
    if (b.accountId != null) await ctx.assertAccount(b.accountId);
    if (b.type === 'transfer') {
      if (b.toAccountId != null) await ctx.assertAccount(b.toAccountId);
      b.categoryId = null;
    } else {
      b.toAccountId = null;
      if (b.categoryId != null) await ctx.assertCategory(b.categoryId, b.type);
    }
  }
  const get = async (id: number) => {
    const r = await sql.get<TplRow>('SELECT * FROM templates WHERE id = ?', [id]);
    if (!r) throw new CoreError(404, '模板不存在');
    return tplDto(r);
  };
  return {
    async list() {
      return (await sql.all<TplRow>('SELECT * FROM templates ORDER BY sort, id')).map(tplDto);
    },
    async create(body: unknown) {
      const b = parse(templateInput, body);
      await validate(b);
      const max = await sql.get<{ m: number }>('SELECT COALESCE(MAX(sort), -1) m FROM templates');
      const id = await sql.insert(
        'INSERT INTO templates (name, type, amount, account_id, to_account_id, category_id, note, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [b.name, b.type, b.amount == null ? null : toCents(b.amount), b.accountId, b.toAccountId, b.categoryId, b.note, (max?.m ?? -1) + 1],
      );
      return get(id);
    },
    async update(id: number, body: unknown) {
      await get(id);
      const b = parse(templateInput, body);
      await validate(b);
      await sql.run('UPDATE templates SET name = ?, type = ?, amount = ?, account_id = ?, to_account_id = ?, category_id = ?, note = ? WHERE id = ?', [
        b.name, b.type, b.amount == null ? null : toCents(b.amount), b.accountId, b.toAccountId, b.categoryId, b.note, id,
      ]);
      return get(id);
    },
    async reorder(body: unknown) {
      const { ids } = parse(reorderInput, body);
      await sql.tx(async () => {
        for (const [i, id] of ids.entries()) await sql.run('UPDATE templates SET sort = ? WHERE id = ?', [i, id]);
      });
      return { ok: true };
    },
    async remove(id: number) {
      await sql.run('DELETE FROM templates WHERE id = ?', [id]);
      return { ok: true };
    },
  };
}

/* ============================== Goals ============================== */
type GoalRow = { id: number; name: string; icon: string; color: string; target: number; deadline: string | null; sort: number; created_at: string; saved: number };

export function goalsService(ctx: Ctx) {
  const { sql } = ctx;
  async function list(): Promise<Goal[]> {
    return (await sql.all<GoalRow>(
      'SELECT g.*, COALESCE((SELECT SUM(amount) FROM goal_entries e WHERE e.goal_id = g.id), 0) saved FROM goals g ORDER BY sort, id',
    )).map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      color: g.color,
      target: fromCents(g.target),
      deadline: g.deadline,
      sort: g.sort,
      createdAt: g.created_at,
      saved: fromCents(g.saved),
    }));
  }
  const one = async (id: number) => {
    const g = (await list()).find((x) => x.id === id);
    if (!g) throw new CoreError(404, '目標不存在');
    return g;
  };
  return {
    list,
    async create(body: unknown) {
      const b = parse(goalInput, body);
      const max = await sql.get<{ m: number }>('SELECT COALESCE(MAX(sort), -1) m FROM goals');
      const id = await sql.insert('INSERT INTO goals (name, icon, color, target, deadline, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        b.name, b.icon, b.color, toCents(b.target), b.deadline, (max?.m ?? -1) + 1, stamp(),
      ]);
      return one(id);
    },
    async update(id: number, body: unknown) {
      await one(id);
      const b = parse(goalInput, body);
      await sql.run('UPDATE goals SET name = ?, icon = ?, color = ?, target = ?, deadline = ? WHERE id = ?', [b.name, b.icon, b.color, toCents(b.target), b.deadline, id]);
      return one(id);
    },
    async remove(id: number) {
      await sql.run('DELETE FROM goals WHERE id = ?', [id]);
      return { ok: true };
    },
    async entries(id: number): Promise<GoalEntry[]> {
      await one(id);
      return (await sql.all<{ id: number; amount: number; note: string; created_at: string }>('SELECT * FROM goal_entries WHERE goal_id = ? ORDER BY id DESC', [id])).map((e) => ({
        id: e.id,
        amount: fromCents(e.amount),
        note: e.note,
        createdAt: e.created_at,
      }));
    },
    async addEntry(id: number, body: unknown) {
      const g = await one(id);
      const b = parse(goalEntryInput, body);
      if (g.saved + b.amount < 0) throw new CoreError(400, '提領金額不可超過已存金額');
      await sql.run('INSERT INTO goal_entries (goal_id, amount, note, created_at) VALUES (?, ?, ?, ?)', [id, toCents(b.amount), b.note, stamp()]);
      return one(id);
    },
    async removeEntry(id: number, entryId: number) {
      await sql.run('DELETE FROM goal_entries WHERE id = ? AND goal_id = ?', [entryId, id]);
      return one(id);
    },
  };
}

/* ============================== Installments ============================== */
type PlanRow = { id: number; account_id: number; category_id: number | null; name: string; total: number; periods: number; start_date: string };

export function installmentsService(ctx: Ctx) {
  const { sql } = ctx;
  async function dto(p: PlanRow): Promise<InstallmentPlan> {
    const s = (await sql.get<{ n: number; a: number }>(
      'SELECT COUNT(*) n, COALESCE(SUM(amount), 0) a FROM transactions WHERE installment_id = ? AND deleted_at IS NULL AND occurred_at <= ?',
      [p.id, nowLocal()],
    ))!;
    return { id: p.id, name: p.name, total: fromCents(p.total), periods: p.periods, accountId: p.account_id, categoryId: p.category_id, startDate: p.start_date, posted: s.n, postedAmount: fromCents(s.a) };
  }
  return {
    async list() {
      const rows = await sql.all<PlanRow>('SELECT * FROM installment_plans ORDER BY start_date');
      const out: InstallmentPlan[] = [];
      for (const r of rows) out.push(await dto(r));
      return out;
    },
    async create(body: unknown) {
      const b = parse(installmentInput, body);
      await ctx.assertAccount(b.accountId);
      if (b.categoryId != null) await ctx.assertCategory(b.categoryId, 'expense');
      const total = toCents(b.total);
      // split in the currency's smallest unit (TWD/JPY → whole units); remainder on the first period
      const digits = CURRENCIES[(await ctx.accountCurrency(b.accountId)) as Currency]?.digits ?? 2;
      const unit = digits === 0 ? 100 : 1;
      const per = Math.floor(total / unit / b.periods) * unit;
      const first = total - per * (b.periods - 1);
      const start = parseISO(b.startDate);
      const id = await sql.tx(async () => {
        const id = await sql.insert('INSERT INTO installment_plans (account_id, category_id, name, total, periods, start_date) VALUES (?, ?, ?, ?, ?, ?)', [
          b.accountId, b.categoryId, b.name, total, b.periods, b.startDate,
        ]);
        for (let i = 0; i < b.periods; i++) {
          const amount = i === 0 ? first : per;
          const now = stamp();
          await sql.run(
            `INSERT INTO transactions (type, amount, base_amount, account_id, category_id, occurred_at, note, installment_id, installment_no, created_at, updated_at)
             VALUES ('expense', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [amount, await ctx.toBase(b.accountId, amount), b.accountId, b.categoryId, `${format(addMonths(start, i), 'yyyy-MM-dd')}T${b.time}`,
              `${b.name}（分期 ${i + 1}/${b.periods}）`, id, i + 1, now, now],
          );
        }
        return id;
      });
      return dto((await sql.get<PlanRow>('SELECT * FROM installment_plans WHERE id = ?', [id]))!);
    },
    /** mode=future: keep posted periods; mode=all: remove every period */
    async remove(id: number, mode: 'future' | 'all') {
      if (!(await sql.get('SELECT id FROM installment_plans WHERE id = ?', [id]))) throw new CoreError(404, '分期不存在');
      const target = await sql.all<{ id: number }>(
        `SELECT id FROM transactions WHERE installment_id = ? ${mode === 'future' ? 'AND occurred_at > ?' : ''}`,
        mode === 'future' ? [id, nowLocal()] : [id],
      );
      await sql.tx(async () => {
        for (const t of target) await sql.run('DELETE FROM transactions WHERE id = ?', [t.id]);
        await sql.run('UPDATE transactions SET installment_id = NULL WHERE installment_id = ?', [id]);
        await sql.run('DELETE FROM installment_plans WHERE id = ?', [id]);
      });
      return { ok: true, removed: target.length };
    },
  };
}
