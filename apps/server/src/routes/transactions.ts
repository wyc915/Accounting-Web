import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, isNull, isNotNull, lt, lte, like, or, sql, type SQL } from 'drizzle-orm';
import { transactionInput, type Summary, type Transaction, type TransactionInput } from '@ledger/shared';
import { db, fromCents, schema, sqlite, toCents } from '../db/index.js';
import { HttpError, idParam, parse } from '../util.js';
import { assertAccount } from './accounts.js';
import { assertCategory } from './categories.js';
import { convertBetween, toBase } from '../currency.js';
import { removeAttachmentFiles } from './attachments.js';

const { transactions: tx, transactionTags: tt, categories, tags, attachments } = schema;

type Row = typeof tx.$inferSelect;

/** Row → DTO, with tags and attachment ids */
export function toDtos(rows: Row[]): Transaction[] {
  const ids = rows.map((r) => r.id);
  const links = ids.length ? db.select().from(tt).where(inArray(tt.transactionId, ids)).all() : [];
  const files = ids.length
    ? db.select({ id: attachments.id, txId: attachments.transactionId }).from(attachments).where(inArray(attachments.transactionId, ids)).all()
    : [];
  const tagMap = new Map<number, number[]>();
  for (const l of links) tagMap.set(l.transactionId, [...(tagMap.get(l.transactionId) ?? []), l.tagId]);
  const fileMap = new Map<number, number[]>();
  for (const f of files) fileMap.set(f.txId, [...(fileMap.get(f.txId) ?? []), f.id]);
  return rows.map((r) => ({
    id: r.id,
    type: r.type as Transaction['type'],
    amount: fromCents(r.amount),
    baseAmount: fromCents(r.baseAmount ?? r.amount),
    accountId: r.accountId,
    toAccountId: r.toAccountId,
    toAmount: r.toAmount == null ? null : fromCents(r.toAmount),
    categoryId: r.categoryId,
    occurredAt: r.occurredAt,
    note: r.note,
    tagIds: tagMap.get(r.id) ?? [],
    installmentId: r.installmentId,
    installmentNo: r.installmentNo,
    attachmentIds: fileMap.get(r.id) ?? [],
  }));
}

const nums = (v: unknown) =>
  String(v ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

/** Builds WHERE conditions from query string (shared by list + summary) */
function buildWhere(uid: number, q: Record<string, string | undefined>): SQL[] {
  const w: SQL[] = [eq(tx.userId, uid), isNull(tx.deletedAt)];
  if (q.from) w.push(gte(tx.occurredAt, q.from));
  if (q.to) w.push(lt(tx.occurredAt, q.to)); // exclusive
  if (q.type && ['expense', 'income', 'transfer'].includes(q.type)) w.push(eq(tx.type, q.type));
  const cats = nums(q.categoryIds);
  if (cats.length) {
    // include sub-categories of selected parents
    const sub = db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, uid), inArray(categories.parentId, cats))).all();
    w.push(inArray(tx.categoryId, [...cats, ...sub.map((s) => s.id)]));
  }
  const accs = nums(q.accountIds);
  if (accs.length) w.push(or(inArray(tx.accountId, accs), inArray(tx.toAccountId, accs))!);
  if (q.min && !isNaN(+q.min)) w.push(gte(tx.amount, toCents(+q.min)));
  if (q.max && !isNaN(+q.max)) w.push(lte(tx.amount, toCents(+q.max)));
  const tg = nums(q.tagIds);
  if (tg.length) w.push(inArray(tx.id, db.select({ id: tt.transactionId }).from(tt).where(inArray(tt.tagId, tg))));
  if (q.q?.trim()) {
    const term = `%${q.q.trim().replace(/[%_]/g, '')}%`;
    w.push(
      or(
        like(tx.note, term),
        inArray(tx.categoryId, db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, uid), like(categories.name, term)))),
        inArray(tx.id, db.select({ id: tt.transactionId }).from(tt).innerJoin(tags, eq(tags.id, tt.tagId)).where(and(eq(tags.userId, uid), like(tags.name, term)))),
      )!,
    );
  }
  return w;
}

function validate(uid: number, b: TransactionInput) {
  assertAccount(uid, b.accountId);
  if (b.type === 'transfer') {
    assertAccount(uid, b.toAccountId!);
    b.categoryId = null;
  } else {
    b.toAccountId = null;
    b.toAmount = null;
    if (b.categoryId != null) assertCategory(uid, b.categoryId, b.type);
  }
  if (b.tagIds.length) {
    const owned = db.select({ id: tags.id }).from(tags).where(and(eq(tags.userId, uid), inArray(tags.id, b.tagIds))).all();
    if (owned.length !== new Set(b.tagIds).size) throw new HttpError(400, '標籤不存在');
  }
}

/** money columns for a validated input */
function moneyCols(uid: number, b: TransactionInput) {
  const amount = toCents(b.amount);
  return {
    amount,
    baseAmount: toBase(uid, b.accountId, amount),
    toAmount: b.type === 'transfer' ? (b.toAmount != null ? toCents(b.toAmount) : convertBetween(uid, b.accountId, b.toAccountId!, amount)) : null,
  };
}

function getOwned(uid: number, id: number) {
  const r = db.select().from(tx).where(and(eq(tx.id, id), eq(tx.userId, uid))).get();
  if (!r) throw new HttpError(404, '紀錄不存在');
  return r;
}

/** permanently remove soft-deleted rows older than 7 days (and their photos) */
function purgeOld(uid: number) {
  const old = sqlite
    .prepare(`SELECT id FROM transactions WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < datetime('now', '-7 days')`)
    .all(uid) as { id: number }[];
  if (!old.length) return;
  removeAttachmentFiles(uid, old.map((o) => o.id));
  db.delete(tx).where(and(eq(tx.userId, uid), isNotNull(tx.deletedAt), lt(tx.deletedAt, sql`datetime('now', '-7 days')`))).run();
}

export async function transactionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/transactions', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit) || 500, 1), 2000);
    const rows = db
      .select()
      .from(tx)
      .where(and(...buildWhere(req.user.uid, q)))
      .orderBy(desc(tx.occurredAt), desc(tx.id))
      .limit(limit)
      .all();
    return toDtos(rows);
  });

  /** totals are in base currency */
  app.get('/api/transactions/summary', async (req): Promise<Summary> => {
    const q = req.query as Record<string, string | undefined>;
    const where = and(...buildWhere(req.user.uid, q));
    const base = sql`COALESCE(${tx.baseAmount}, ${tx.amount})`;
    const totals = db
      .select({
        income: sql<number>`COALESCE(SUM(CASE WHEN ${tx.type} = 'income' THEN ${base} END), 0)`,
        expense: sql<number>`COALESCE(SUM(CASE WHEN ${tx.type} = 'expense' THEN ${base} END), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(tx)
      .where(where)
      .get()!;
    const byCat = db
      .select({
        categoryId: sql<number | null>`COALESCE(${categories.parentId}, ${categories.id})`,
        amount: sql<number>`SUM(${base})`,
        count: sql<number>`COUNT(*)`,
      })
      .from(tx)
      .leftJoin(categories, eq(categories.id, tx.categoryId))
      .where(and(where, eq(tx.type, 'expense')))
      .groupBy(sql`1`)
      .orderBy(sql`2 DESC`)
      .all();
    return {
      income: fromCents(totals.income),
      expense: fromCents(totals.expense),
      balance: fromCents(totals.income - totals.expense),
      count: totals.count,
      byCategory: byCat.map((c) => ({ ...c, amount: fromCents(c.amount) })),
    };
  });

  app.post('/api/transactions', async (req) => {
    const uid = req.user.uid;
    const b = parse(transactionInput, req.body);
    validate(uid, b);
    const m = moneyCols(uid, b);
    const row = db.transaction((t) => {
      const r = t
        .insert(tx)
        .values({
          userId: uid,
          type: b.type,
          ...m,
          accountId: b.accountId,
          toAccountId: b.toAccountId,
          categoryId: b.categoryId,
          occurredAt: b.occurredAt,
          note: b.note,
        })
        .returning()
        .get();
      if (b.tagIds.length) t.insert(tt).values([...new Set(b.tagIds)].map((tagId) => ({ transactionId: r.id, tagId }))).run();
      return r;
    });
    return toDtos([row])[0];
  });

  app.put('/api/transactions/:id', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    getOwned(uid, id);
    const b = parse(transactionInput, req.body);
    validate(uid, b);
    const m = moneyCols(uid, b);
    const row = db.transaction((t) => {
      const r = t
        .update(tx)
        .set({
          type: b.type,
          ...m,
          accountId: b.accountId,
          toAccountId: b.toAccountId,
          categoryId: b.categoryId,
          occurredAt: b.occurredAt,
          note: b.note,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(and(eq(tx.id, id), eq(tx.userId, uid)))
        .returning()
        .get()!;
      t.delete(tt).where(eq(tt.transactionId, id)).run();
      if (b.tagIds.length) t.insert(tt).values([...new Set(b.tagIds)].map((tagId) => ({ transactionId: id, tagId }))).run();
      return r;
    });
    return toDtos([row])[0];
  });

  /** soft delete (undo-able) */
  app.delete('/api/transactions/:id', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    getOwned(uid, id);
    db.update(tx).set({ deletedAt: sql`(datetime('now'))` }).where(and(eq(tx.id, id), eq(tx.userId, uid))).run();
    purgeOld(uid);
    return { ok: true };
  });

  app.post('/api/transactions/:id/restore', async (req) => {
    const uid = req.user.uid;
    const id = idParam(req.params);
    getOwned(uid, id);
    const row = db.update(tx).set({ deletedAt: null }).where(and(eq(tx.id, id), eq(tx.userId, uid))).returning().get()!;
    return toDtos([row])[0];
  });
}
