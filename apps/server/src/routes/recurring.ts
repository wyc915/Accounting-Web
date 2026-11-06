import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { addDays, addMonths, addWeeks, addYears, format, parseISO } from 'date-fns';
import { recurringInput, type RecurringInput, type RecurringRule } from '@ledger/shared';
import { db, fromCents, schema, sqlite, toCents } from '../db/index.js';
import { HttpError, idParam, parse } from '../util.js';
import { assertAccount } from './accounts.js';
import { assertCategory } from './categories.js';
import { convertBetween, toBase } from '../currency.js';

const { recurringRules: rules, transactions: tx } = schema;
type Row = typeof rules.$inferSelect;

const MAX_PER_RUN = 400;
const today = () => format(new Date(), 'yyyy-MM-dd');

/** n-th occurrence (0-based), always computed from the start date to avoid month-end drift */
export function occurrence(r: Pick<Row, 'startDate' | 'freq' | 'interval'>, n: number) {
  const s = parseISO(r.startDate);
  const k = n * r.interval;
  const d = r.freq === 'daily' ? addDays(s, k) : r.freq === 'weekly' ? addWeeks(s, k) : r.freq === 'monthly' ? addMonths(s, k) : addYears(s, k);
  return format(d, 'yyyy-MM-dd');
}
const nextOrNull = (r: Row, n: number) => {
  const d = occurrence(r, n);
  return r.endDate && d > r.endDate ? null : d;
};

/** Generate due transactions for one user (or all users). Returns number created. */
export function processRecurring(userId?: number) {
  const t = today();
  const due = (
    userId
      ? db.select().from(rules).where(and(eq(rules.userId, userId), eq(rules.active, true))).all()
      : db.select().from(rules).where(eq(rules.active, true)).all()
  ).filter((r) => r.nextDate && r.nextDate <= t);

  let created = 0;
  for (const r of due) {
    // convert with the rate current at posting time (missing rate → 1:1, never blocks auto-posting)
    const baseAmount = toBase(r.userId, r.accountId, r.amount, false);
    let toAmount: number | null = null;
    if (r.type === 'transfer' && r.toAccountId) {
      try {
        toAmount = convertBetween(r.userId, r.accountId, r.toAccountId, r.amount);
      } catch {
        toAmount = r.amount;
      }
    }
    db.transaction((trx) => {
      let n = r.runCount;
      let next: string | null = r.nextDate;
      let i = 0;
      while (next && next <= t && i < MAX_PER_RUN) {
        trx.insert(tx)
          .values({
            userId: r.userId,
            type: r.type,
            amount: r.amount,
            baseAmount,
            toAmount,
            accountId: r.accountId,
            toAccountId: r.toAccountId,
            categoryId: r.categoryId,
            occurredAt: `${next}T${r.time}`,
            note: r.note,
            recurringId: r.id,
          })
          .run();
        created++;
        i++;
        n++;
        next = nextOrNull(r, n);
      }
      trx.update(rules).set({ runCount: n, nextDate: next }).where(eq(rules.id, r.id)).run();
    });
  }
  return created;
}

const toDto = (r: Row): RecurringRule => ({
  id: r.id,
  type: r.type as RecurringRule['type'],
  amount: fromCents(r.amount),
  accountId: r.accountId,
  toAccountId: r.toAccountId,
  categoryId: r.categoryId,
  note: r.note,
  freq: r.freq as RecurringRule['freq'],
  interval: r.interval,
  startDate: r.startDate,
  endDate: r.endDate,
  time: r.time,
  runCount: r.runCount,
  nextDate: r.nextDate,
  active: r.active,
});

function validate(uid: number, b: RecurringInput) {
  assertAccount(uid, b.accountId);
  if (b.type === 'transfer') {
    assertAccount(uid, b.toAccountId!);
    b.categoryId = null;
  } else {
    b.toAccountId = null;
    assertCategory(uid, b.categoryId!, b.type);
  }
}

/** first occurrence index strictly after `after` (or 0 when nothing generated yet) */
function firstIndexAfter(r: Row, after: string | null) {
  if (!after) return 0;
  for (let n = 0; n < 100_000; n++) if (occurrence(r, n) > after) return n;
  return 100_000;
}

export async function recurringRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/recurring', async (req) => {
    processRecurring(req.user.uid);
    return db.select().from(rules).where(eq(rules.userId, req.user.uid)).orderBy(asc(rules.nextDate), asc(rules.id)).all().map(toDto);
  });

  app.post('/api/recurring', async (req) => {
    const uid = req.user.uid;
    const b = parse(recurringInput, req.body);
    validate(uid, b);
    const row = db
      .insert(rules)
      .values({ ...b, userId: uid, amount: toCents(b.amount), runCount: 0, nextDate: b.endDate && b.startDate > b.endDate ? null : b.startDate })
      .returning()
      .get();
    const created = processRecurring(uid);
    return { rule: toDto(db.select().from(rules).where(eq(rules.id, row.id)).get()!), created };
  });

  app.put('/api/recurring/:id', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    const cur = db.select().from(rules).where(and(eq(rules.id, id), eq(rules.userId, uid))).get();
    if (!cur) throw new HttpError(404, '規則不存在');
    const b = parse(recurringInput, req.body);
    validate(uid, b);
    const merged = { ...cur, ...b, amount: toCents(b.amount) } as Row;
    // resume after the last generated occurrence so edits never duplicate history
    const last = (
      sqlite.prepare(`SELECT MAX(substr(occurred_at,1,10)) d FROM transactions WHERE recurring_id = ? AND deleted_at IS NULL`).get(id) as { d: string | null }
    ).d;
    const n = firstIndexAfter(merged, last ?? (cur.runCount > 0 ? occurrence(cur, cur.runCount - 1) : null));
    db.update(rules)
      .set({ ...b, amount: toCents(b.amount), runCount: n, nextDate: nextOrNull(merged, n) })
      .where(eq(rules.id, id))
      .run();
    const created = processRecurring(uid);
    return { rule: toDto(db.select().from(rules).where(eq(rules.id, id)).get()!), created };
  });

  app.delete('/api/recurring/:id', async (req) => {
    const id = idParam(req.params);
    db.delete(rules).where(and(eq(rules.id, id), eq(rules.userId, req.user.uid))).run();
    return { ok: true };
  });
}
