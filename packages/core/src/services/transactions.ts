import { subDays } from 'date-fns';
import { transactionInput, type Summary, type Transaction, type TransactionInput } from '@ledger/shared';
import type { Ctx } from '../ctx.js';
import { placeholders, type Param } from '../db.js';
import { CoreError, fromCents, nums, parse, stamp, toCents } from '../util.js';

type TxRow = {
  id: number; type: string; amount: number; base_amount: number; account_id: number; to_account_id: number | null;
  to_amount: number | null; category_id: number | null; occurred_at: string; note: string; installment_id: number | null;
  installment_no: number | null;
};
export type TxFilter = Record<string, string | number | undefined>;

const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** detect image type from magic bytes of base64 data (never trust the given mime) */
export function sniffBase64(b64: string): string | null {
  const head = atob(b64.slice(0, 24));
  const c = (i: number) => head.charCodeAt(i);
  if (c(0) === 0xff && c(1) === 0xd8 && c(2) === 0xff) return 'image/jpeg';
  if (c(0) === 0x89 && head.slice(1, 4) === 'PNG') return 'image/png';
  if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') return 'image/webp';
  if (head.slice(0, 3) === 'GIF') return 'image/gif';
  return null;
}

export function transactionsService(ctx: Ctx) {
  const { sql } = ctx;

  async function toDtos(rows: TxRow[]): Promise<Transaction[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const links = await sql.all<{ transaction_id: number; tag_id: number }>(
      `SELECT transaction_id, tag_id FROM transaction_tags WHERE transaction_id IN (${placeholders(ids.length)})`,
      ids,
    );
    const files = await sql.all<{ id: number; transaction_id: number }>(
      `SELECT id, transaction_id FROM attachments WHERE transaction_id IN (${placeholders(ids.length)}) ORDER BY id`,
      ids,
    );
    const tagMap = new Map<number, number[]>();
    for (const l of links) tagMap.set(l.transaction_id, [...(tagMap.get(l.transaction_id) ?? []), l.tag_id]);
    const fileMap = new Map<number, number[]>();
    for (const f of files) fileMap.set(f.transaction_id, [...(fileMap.get(f.transaction_id) ?? []), f.id]);
    return rows.map((r) => ({
      id: r.id,
      type: r.type as Transaction['type'],
      amount: fromCents(r.amount),
      baseAmount: fromCents(r.base_amount ?? r.amount),
      accountId: r.account_id,
      toAccountId: r.to_account_id,
      toAmount: r.to_amount == null ? null : fromCents(r.to_amount),
      categoryId: r.category_id,
      occurredAt: r.occurred_at,
      note: r.note,
      tagIds: tagMap.get(r.id) ?? [],
      installmentId: r.installment_id,
      installmentNo: r.installment_no,
      attachmentIds: fileMap.get(r.id) ?? [],
    }));
  }

  /** WHERE clause shared by list + summary */
  async function where(q: TxFilter): Promise<[string, Param[]]> {
    const w = ['t.deleted_at IS NULL'];
    const p: Param[] = [];
    if (q.from) (w.push('t.occurred_at >= ?'), p.push(String(q.from)));
    if (q.to) (w.push('t.occurred_at < ?'), p.push(String(q.to)));
    if (q.type && ['expense', 'income', 'transfer'].includes(String(q.type))) (w.push('t.type = ?'), p.push(String(q.type)));
    const cats = nums(q.categoryIds);
    if (cats.length) {
      const sub = await sql.all<{ id: number }>(`SELECT id FROM categories WHERE parent_id IN (${placeholders(cats.length)})`, cats);
      const all = [...cats, ...sub.map((s) => s.id)];
      w.push(`t.category_id IN (${placeholders(all.length)})`);
      p.push(...all);
    }
    const accs = nums(q.accountIds);
    if (accs.length) {
      w.push(`(t.account_id IN (${placeholders(accs.length)}) OR t.to_account_id IN (${placeholders(accs.length)}))`);
      p.push(...accs, ...accs);
    }
    if (q.min !== undefined && q.min !== '' && !isNaN(+q.min)) (w.push('t.amount >= ?'), p.push(toCents(+q.min)));
    if (q.max !== undefined && q.max !== '' && !isNaN(+q.max)) (w.push('t.amount <= ?'), p.push(toCents(+q.max)));
    const tg = nums(q.tagIds);
    if (tg.length) {
      w.push(`t.id IN (SELECT transaction_id FROM transaction_tags WHERE tag_id IN (${placeholders(tg.length)}))`);
      p.push(...tg);
    }
    const term = String(q.q ?? '').trim().replace(/[%_]/g, '');
    if (term) {
      const like = `%${term}%`;
      w.push(`(t.note LIKE ? OR t.category_id IN (SELECT id FROM categories WHERE name LIKE ?)
        OR t.id IN (SELECT x.transaction_id FROM transaction_tags x JOIN tags g ON g.id = x.tag_id WHERE g.name LIKE ?))`);
      p.push(like, like, like);
    }
    return [w.join(' AND '), p];
  }

  async function validate(b: TransactionInput) {
    await ctx.assertAccount(b.accountId);
    if (b.type === 'transfer') {
      await ctx.assertAccount(b.toAccountId!);
      b.categoryId = null;
    } else {
      b.toAccountId = null;
      b.toAmount = null;
      if (b.categoryId != null) await ctx.assertCategory(b.categoryId, b.type);
    }
    if (b.tagIds.length) {
      const n = await sql.get<{ c: number }>(`SELECT COUNT(*) c FROM tags WHERE id IN (${placeholders(b.tagIds.length)})`, b.tagIds);
      if (n?.c !== new Set(b.tagIds).size) throw new CoreError(400, '標籤不存在');
    }
  }
  async function money(b: TransactionInput) {
    const amount = toCents(b.amount);
    return {
      amount,
      base: await ctx.toBase(b.accountId, amount),
      to: b.type === 'transfer' ? (b.toAmount != null ? toCents(b.toAmount) : await ctx.convertBetween(b.accountId, b.toAccountId!, amount)) : null,
    };
  }
  async function setTags(id: number, tagIds: number[]) {
    await sql.run('DELETE FROM transaction_tags WHERE transaction_id = ?', [id]);
    for (const t of new Set(tagIds)) await sql.run('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', [id, t]);
  }
  const owned = async (id: number) => {
    const r = await sql.get<TxRow>('SELECT * FROM transactions WHERE id = ?', [id]);
    if (!r) throw new CoreError(404, '紀錄不存在');
    return r;
  };
  const byId = async (id: number) => (await toDtos([(await sql.get<TxRow>('SELECT * FROM transactions WHERE id = ?', [id]))!]))[0];

  return {
    toDtos,
    async list(q: TxFilter) {
      const [w, p] = await where(q);
      const limit = Math.min(Math.max(Number(q.limit) || 500, 1), 2000);
      return toDtos(await sql.all<TxRow>(`SELECT t.* FROM transactions t WHERE ${w} ORDER BY t.occurred_at DESC, t.id DESC LIMIT ${limit}`, p));
    },

    /** totals are in base currency */
    async summary(q: TxFilter): Promise<Summary> {
      const [w, p] = await where(q);
      const tot = (await sql.get<{ income: number; expense: number; count: number }>(
        `SELECT COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.base_amount END), 0) income,
                COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.base_amount END), 0) expense,
                COUNT(*) count
         FROM transactions t WHERE ${w}`,
        p,
      ))!;
      const byCat = await sql.all<{ categoryId: number | null; amount: number; count: number }>(
        `SELECT COALESCE(c.parent_id, c.id) categoryId, SUM(t.base_amount) amount, COUNT(*) count
         FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${w} AND t.type = 'expense' GROUP BY 1 ORDER BY 2 DESC`,
        p,
      );
      return {
        income: fromCents(tot.income),
        expense: fromCents(tot.expense),
        balance: fromCents(tot.income - tot.expense),
        count: tot.count,
        byCategory: byCat.map((c) => ({ ...c, amount: fromCents(c.amount) })),
      };
    },

    async create(body: unknown) {
      const b = parse(transactionInput, body);
      await validate(b);
      const m = await money(b);
      const id = await sql.tx(async () => {
        const now = stamp();
        const id = await sql.insert(
          `INSERT INTO transactions (type, amount, base_amount, account_id, to_account_id, to_amount, category_id, occurred_at, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [b.type, m.amount, m.base, b.accountId, b.toAccountId, m.to, b.categoryId, b.occurredAt, b.note, now, now],
        );
        await setTags(id, b.tagIds);
        return id;
      });
      return byId(id);
    },

    async update(id: number, body: unknown) {
      await owned(id);
      const b = parse(transactionInput, body);
      await validate(b);
      const m = await money(b);
      await sql.tx(async () => {
        await sql.run(
          `UPDATE transactions SET type = ?, amount = ?, base_amount = ?, account_id = ?, to_account_id = ?, to_amount = ?, category_id = ?,
             occurred_at = ?, note = ?, updated_at = ? WHERE id = ?`,
          [b.type, m.amount, m.base, b.accountId, b.toAccountId, m.to, b.categoryId, b.occurredAt, b.note, stamp(), id],
        );
        await setTags(id, b.tagIds);
      });
      return byId(id);
    },

    /** soft delete (undo-able); rows deleted > 7 days ago are purged */
    async remove(id: number) {
      await owned(id);
      await sql.run('UPDATE transactions SET deleted_at = ? WHERE id = ?', [stamp(), id]);
      await sql.run('DELETE FROM transactions WHERE deleted_at IS NOT NULL AND deleted_at < ?', [stamp(subDays(new Date(), 7))]);
      return { ok: true };
    },
    async restore(id: number) {
      await owned(id);
      await sql.run('UPDATE transactions SET deleted_at = NULL WHERE id = ?', [id]);
      return byId(id);
    },

    /* ---------- receipt photos (base64 in the encrypted DB) ---------- */
    async addAttachment(txId: number, base64: string) {
      await owned(txId);
      const n = await sql.get<{ c: number }>('SELECT COUNT(*) c FROM attachments WHERE transaction_id = ?', [txId]);
      if ((n?.c ?? 0) >= MAX_PHOTOS) throw new CoreError(400, `每筆紀錄最多 ${MAX_PHOTOS} 張照片`);
      const mime = sniffBase64(base64);
      if (!mime) throw new CoreError(400, '只接受 JPG、PNG、WEBP、GIF 圖片');
      const size = Math.floor((base64.length * 3) / 4);
      if (size > MAX_PHOTO_BYTES) throw new CoreError(400, '圖片不可超過 10MB');
      const id = await sql.insert('INSERT INTO attachments (transaction_id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)', [txId, mime, size, base64, stamp()]);
      return { id, mime, size };
    },
    async getAttachment(id: number) {
      const a = await sql.get<{ mime: string; data: string }>('SELECT mime, data FROM attachments WHERE id = ?', [id]);
      if (!a) throw new CoreError(404, '照片不存在');
      return a;
    },
    async removeAttachment(id: number) {
      await sql.run('DELETE FROM attachments WHERE id = ?', [id]);
      return { ok: true };
    },
  };
}
