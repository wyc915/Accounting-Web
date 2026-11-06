import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { format } from 'date-fns';
import { readFileSync, existsSync } from 'node:fs';
import { CURRENCY_CODES, type ImportPreview, type ImportRow, type TxType } from '@ledger/shared';
import { fromCents, sqlite, toCents } from '../db/index.js';
import { HttpError } from '../util.js';
import { baseCurrency, convertBetween, toBase } from '../currency.js';
import { attachmentPath, removeAttachmentFiles, storeAttachment } from './attachments.js';

const TYPE_LABEL: Record<TxType, string> = { expense: '支出', income: '收入', transfer: '轉帳' };
const HEADERS = ['日期', '類型', '金額', '幣別', '帳戶', '轉入帳戶', '轉入金額', '類別', '子類別', '備註', '標籤'];

/* ============================ Export ============================ */
function exportRows(uid: number, from?: string, to?: string) {
  const where = [`t.user_id = ?`, `t.deleted_at IS NULL`];
  const args: unknown[] = [uid];
  if (from) (where.push(`t.occurred_at >= ?`), args.push(from));
  if (to) (where.push(`t.occurred_at < ?`), args.push(to));
  const rows = sqlite
    .prepare(
      `SELECT t.id, t.occurred_at, t.type, t.amount, t.to_amount, t.note,
         a.name AS account, a.currency, ta.name AS to_account,
         COALESCE(p.name, c.name) AS category, CASE WHEN p.id IS NOT NULL THEN c.name END AS sub,
         (SELECT GROUP_CONCAT(g.name, ' ') FROM transaction_tags x JOIN tags g ON g.id = x.tag_id WHERE x.transaction_id = t.id) AS tags
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts ta ON ta.id = t.to_account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE ${where.join(' AND ')} ORDER BY t.occurred_at, t.id`,
    )
    .all(...args) as Record<string, string | number | null>[];
  return rows.map((r) => [
    String(r.occurred_at).replace('T', ' '),
    TYPE_LABEL[r.type as TxType],
    fromCents(Number(r.amount)),
    r.currency,
    r.account,
    r.to_account ?? '',
    r.to_amount == null ? '' : fromCents(Number(r.to_amount)),
    r.category ?? '',
    r.sub ?? '',
    r.note ?? '',
    r.tags ? String(r.tags).split(' ').map((t) => `#${t}`).join(' ') : '',
  ]);
}

const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* ============================ Import parsing ============================ */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') (cell += '"'), i++;
        else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') (row.push(cell), (cell = ''));
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) (row.push(cell), out.push(row));
  return out.filter((r) => r.some((c) => c.trim() !== ''));
}

async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = (r.values as unknown[]).slice(1).map((v) => {
      if (v instanceof Date) return format(new Date(v.getTime() + v.getTimezoneOffset() * 60000), 'yyyy-MM-dd HH:mm');
      if (v && typeof v === 'object') {
        const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
        if (o.richText) return o.richText.map((t) => t.text).join('');
        if (o.text) return o.text;
        if (o.result != null) return String(o.result);
      }
      return v == null ? '' : String(v);
    });
    out.push(vals);
  });
  return out;
}

const ALIASES: Record<string, string[]> = {
  date: ['日期', '時間', '交易日期', 'date', 'datetime', 'time'],
  type: ['類型', '收支', 'type'],
  amount: ['金額', 'amount', 'value'],
  account: ['帳戶', 'account', '付款方式'],
  toAccount: ['轉入帳戶', 'to account', 'toaccount'],
  toAmount: ['轉入金額', 'to amount'],
  category: ['類別', '分類', 'category'],
  sub: ['子類別', '子分類', 'subcategory'],
  note: ['備註', '說明', '描述', 'note', 'memo', 'description'],
  tags: ['標籤', 'tags', 'tag'],
};

function normDate(s: string): string | null {
  s = s.trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial date
    const d = new Date(Math.round((parseFloat(s) - 25569) * 86400 * 1000));
    return format(new Date(d.getTime() + d.getTimezoneOffset() * 60000), "yyyy-MM-dd'T'HH:mm");
  }
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h = '12', mi = '00'] = m;
  const pad = (x: string) => x.padStart(2, '0');
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59) return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}`;
}

function toRows(table: string[][]): ImportRow[] {
  if (table.length < 2) throw new HttpError(400, '檔案沒有資料列');
  const head = table[0].map((h) => h.trim().toLowerCase());
  const col = (k: string) => head.findIndex((h) => ALIASES[k].includes(h));
  const idx = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, col(k)]));
  if (idx.date < 0 || idx.amount < 0) throw new HttpError(400, '找不到「日期」或「金額」欄位，請確認第一列為標題');
  const get = (r: string[], k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');

  return table.slice(1, 5001).map((r, i) => {
    const line = i + 2;
    const rawAmt = get(r, 'amount').replace(/[,\s$¥€£₩฿₫₱]|NT|US|HK|CN|A\$|S\$/gi, '');
    const n = parseFloat(rawAmt.replace(/^\((.*)\)$/, '-$1'));
    const t = get(r, 'type').toLowerCase();
    let type: TxType =
      /轉|transfer/.test(t) ? 'transfer' : /收|income|in$/.test(t) ? 'income' : /支|expense|out$/.test(t) ? 'expense' : n < 0 ? 'expense' : 'income';
    if (!t && !(n < 0)) type = 'expense'; // unsigned amount without type → expense (most common)
    const occurredAt = normDate(get(r, 'date'));
    const row: ImportRow = {
      line,
      occurredAt: occurredAt ?? '',
      type,
      amount: Math.abs(n),
      account: get(r, 'account') || '現金',
      toAccount: get(r, 'toAccount') || null,
      category: get(r, 'category') || null,
      subcategory: get(r, 'sub') || null,
      note: get(r, 'note').slice(0, 200),
      tags: get(r, 'tags')
        .split(/[\s,，、]+/)
        .map((x) => x.replace(/^#/, '').trim())
        .filter(Boolean)
        .slice(0, 10),
    };
    if (!occurredAt) row.error = '日期格式無法辨識';
    else if (!(row.amount > 0)) row.error = '金額無效';
    else if (type === 'transfer' && !row.toAccount) row.error = '轉帳缺少轉入帳戶';
    else if (type === 'transfer' && row.toAccount === row.account) row.error = '轉出與轉入帳戶相同';
    return row;
  });
}

function preview(uid: number, rows: ImportRow[]): ImportPreview {
  const accs = new Set((sqlite.prepare(`SELECT name FROM accounts WHERE user_id = ?`).all(uid) as { name: string }[]).map((a) => a.name));
  const cats = sqlite.prepare(`SELECT c.name, c.type, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.user_id = ?`).all(uid) as {
    name: string;
    type: string;
    parent: string | null;
  }[];
  const catKey = new Set(cats.map((c) => `${c.type}|${c.parent ?? ''}|${c.name}`));
  const tags = new Set((sqlite.prepare(`SELECT name FROM tags WHERE user_id = ?`).all(uid) as { name: string }[]).map((t) => t.name));
  const newAccounts = new Set<string>();
  const newCategories = new Set<string>();
  const newTags = new Set<string>();
  for (const r of rows.filter((x) => !x.error)) {
    for (const a of [r.account, r.toAccount]) if (a && !accs.has(a)) newAccounts.add(a);
    if (r.type !== 'transfer' && r.category) {
      if (!catKey.has(`${r.type}||${r.category}`)) newCategories.add(`${TYPE_LABEL[r.type]}：${r.category}`);
      if (r.subcategory && !catKey.has(`${r.type}|${r.category}|${r.subcategory}`))
        newCategories.add(`${TYPE_LABEL[r.type]}：${r.category} › ${r.subcategory}`);
    }
    for (const t of r.tags) if (!tags.has(t)) newTags.add(t);
  }
  return { rows, newAccounts: [...newAccounts], newCategories: [...newCategories], newTags: [...newTags] };
}

function commit(uid: number, rows: ImportRow[], skipDuplicates: boolean) {
  const base = baseCurrency(uid);
  let created = 0;
  let skipped = 0;
  sqlite.transaction(() => {
    const accId = (name: string) => {
      const a = sqlite.prepare(`SELECT id FROM accounts WHERE user_id = ? AND name = ?`).get(uid, name) as { id: number } | undefined;
      if (a) return a.id;
      const sort = (sqlite.prepare(`SELECT COALESCE(MAX(sort),-1)+1 s FROM accounts WHERE user_id = ?`).get(uid) as { s: number }).s;
      return Number(
        sqlite
          .prepare(`INSERT INTO accounts (user_id, name, type, icon, color, currency, sort) VALUES (?, ?, 'other', 'wallet', '#64748b', ?, ?)`)
          .run(uid, name, base, sort).lastInsertRowid,
      );
    };
    const catId = (type: string, name: string, parentId: number | null) => {
      const c = sqlite
        .prepare(`SELECT id FROM categories WHERE user_id = ? AND type = ? AND name = ? AND parent_id IS ?`)
        .get(uid, type, name, parentId) as { id: number } | undefined;
      if (c) return c.id;
      const color = parentId
        ? (sqlite.prepare(`SELECT color FROM categories WHERE id = ?`).get(parentId) as { color: string }).color
        : '#64748b';
      return Number(
        sqlite
          .prepare(`INSERT INTO categories (user_id, parent_id, type, name, icon, color, sort) VALUES (?, ?, ?, ?, 'tag', ?, 999)`)
          .run(uid, parentId, type, name, color).lastInsertRowid,
      );
    };
    const tagId = (name: string) => {
      const t = sqlite.prepare(`SELECT id FROM tags WHERE user_id = ? AND name = ?`).get(uid, name) as { id: number } | undefined;
      return t ? t.id : Number(sqlite.prepare(`INSERT INTO tags (user_id, name, color) VALUES (?, ?, '#94a3b8')`).run(uid, name).lastInsertRowid);
    };
    const dup = sqlite.prepare(
      `SELECT 1 FROM transactions WHERE user_id = ? AND deleted_at IS NULL AND occurred_at = ? AND type = ? AND amount = ? AND account_id = ? AND note = ? LIMIT 1`,
    );
    const ins = sqlite.prepare(
      `INSERT INTO transactions (user_id, type, amount, base_amount, account_id, to_account_id, to_amount, category_id, occurred_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const link = sqlite.prepare(`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`);

    for (const r of rows) {
      if (r.error || !r.occurredAt || !(r.amount > 0)) continue;
      const a = accId(r.account);
      const amount = toCents(r.amount);
      if (skipDuplicates && dup.get(uid, r.occurredAt, r.type, amount, a, r.note)) {
        skipped++;
        continue;
      }
      let to: number | null = null;
      let toAmount: number | null = null;
      let cat: number | null = null;
      if (r.type === 'transfer') {
        to = accId(r.toAccount!);
        if (to === a) continue;
        toAmount = convertBetween(uid, a, to, amount);
      } else if (r.category) {
        const p = catId(r.type, r.category, null);
        cat = r.subcategory ? catId(r.type, r.subcategory, p) : p;
      }
      const id = Number(ins.run(uid, r.type, amount, toBase(uid, a, amount, false), a, to, toAmount, cat, r.occurredAt, r.note).lastInsertRowid);
      for (const t of r.tags) link.run(id, tagId(t));
      created++;
    }
  })();
  return { created, skipped };
}

/* ============================ Backup / restore ============================ */
const TABLES = {
  accounts: 'id,name,type,icon,color,initial_balance,include_in_total,sort,currency,statement_day,due_day',
  categories: 'id,parent_id,type,name,icon,color,sort',
  tags: 'id,name,color',
  recurring_rules: 'id,type,amount,account_id,to_account_id,category_id,note,freq,interval,start_date,end_date,time,run_count,next_date,active',
  installment_plans: 'id,account_id,category_id,name,total,periods,start_date',
  transactions: 'id,type,amount,base_amount,account_id,to_account_id,to_amount,category_id,occurred_at,note,recurring_id,installment_id,installment_no,created_at',
  budgets: 'id,category_id,amount',
  templates: 'id,name,type,amount,account_id,to_account_id,category_id,note,sort',
  goals: 'id,name,icon,color,target,deadline,sort,created_at',
  goal_entries: 'id,goal_id,amount,note,created_at',
  exchange_rates: 'currency,rate,updated_at',
} as const;

function backup(uid: number, withPhotos: boolean) {
  const data: Record<string, unknown[]> = {};
  for (const [t, cols] of Object.entries(TABLES)) {
    const extra = t === 'transactions' ? ' AND deleted_at IS NULL' : '';
    data[t] = sqlite.prepare(`SELECT ${cols} FROM ${t} WHERE user_id = ?${extra}`).all(uid);
  }
  data.transaction_tags = sqlite
    .prepare(`SELECT x.transaction_id, x.tag_id FROM transaction_tags x JOIN transactions t ON t.id = x.transaction_id WHERE t.user_id = ? AND t.deleted_at IS NULL`)
    .all(uid);
  const atts = sqlite
    .prepare(`SELECT a.id, a.transaction_id, a.file, a.mime FROM attachments a JOIN transactions t ON t.id = a.transaction_id WHERE a.user_id = ? AND t.deleted_at IS NULL`)
    .all(uid) as { id: number; transaction_id: number; file: string; mime: string }[];
  data.attachments = withPhotos
    ? atts
        .filter((a) => existsSync(attachmentPath(uid, a.file)))
        .map((a) => ({ transaction_id: a.transaction_id, mime: a.mime, data: readFileSync(attachmentPath(uid, a.file)).toString('base64') }))
    : [];
  const u = sqlite.prepare(`SELECT base_currency, lock_minutes FROM users WHERE id = ?`).get(uid) as { base_currency: string; lock_minutes: number };
  return { app: 'mint-ledger', version: 1, exportedAt: new Date().toISOString(), settings: u, data };
}

type Rec = Record<string, unknown>;
function restore(uid: number, payload: unknown) {
  const p = payload as { app?: string; version?: number; settings?: Rec; data?: Record<string, Rec[]> };
  if (p?.app !== 'mint-ledger' || p.version !== 1 || !p.data) throw new HttpError(400, '不是有效的薄荷記帳備份檔');
  const d = p.data;
  const base = String(p.settings?.base_currency ?? 'TWD');
  if (!CURRENCY_CODES.includes(base as never)) throw new HttpError(400, '備份檔幣別無效');
  const list = (k: string) => (Array.isArray(d[k]) ? d[k] : []);
  const counts: Record<string, number> = {};

  // remove existing photos first (outside the DB transaction: files)
  const oldTx = (sqlite.prepare(`SELECT id FROM transactions WHERE user_id = ?`).all(uid) as { id: number }[]).map((r) => r.id);
  removeAttachmentFiles(uid, oldTx);

  const photos: { txId: number; buf: Buffer }[] = [];
  sqlite.transaction(() => {
    for (const t of ['transactions', 'installment_plans', 'recurring_rules', 'templates', 'budgets', 'goal_entries', 'goals', 'tags', 'exchange_rates'])
      sqlite.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(uid);
    sqlite.prepare(`UPDATE categories SET parent_id = NULL WHERE user_id = ?`).run(uid);
    sqlite.prepare(`DELETE FROM categories WHERE user_id = ?`).run(uid);
    sqlite.prepare(`DELETE FROM accounts WHERE user_id = ?`).run(uid);
    sqlite.prepare(`UPDATE users SET base_currency = ?, lock_minutes = ? WHERE id = ?`).run(base, Number(p.settings?.lock_minutes) || 5, uid);

    const maps: Record<string, Map<number, number>> = {};
    const remap = (table: string, id: unknown) => (id == null ? null : (maps[table]?.get(Number(id)) ?? null));
    const insert = (table: keyof typeof TABLES, rows: Rec[], fix: (r: Rec) => Rec | null) => {
      const cols = TABLES[table].split(',').filter((c) => c !== 'id');
      const stmt = sqlite.prepare(`INSERT INTO ${table} (user_id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`);
      maps[table] = new Map();
      let n = 0;
      for (const raw of rows) {
        const r = fix({ ...raw });
        if (!r) continue;
        const res = stmt.run(uid, ...cols.map((c) => (r[c] === undefined ? null : r[c]) as never));
        if (raw.id != null) maps[table].set(Number(raw.id), Number(res.lastInsertRowid));
        n++;
      }
      counts[table] = n;
    };

    insert('accounts', list('accounts'), (r) => r);
    // categories: parents first, then children
    const cats = list('categories');
    insert('categories', cats.filter((c) => c.parent_id == null), (r) => r);
    const parentMap = maps.categories;
    insert('categories', cats.filter((c) => c.parent_id != null), (r) => ({ ...r, parent_id: parentMap.get(Number(r.parent_id)) ?? null }));
    for (const [k, v] of parentMap) maps.categories.set(k, v);
    counts.categories = cats.length;
    insert('tags', list('tags'), (r) => r);
    insert('recurring_rules', list('recurring_rules'), (r) => {
      const a = remap('accounts', r.account_id);
      return a ? { ...r, account_id: a, to_account_id: remap('accounts', r.to_account_id), category_id: remap('categories', r.category_id) } : null;
    });
    insert('installment_plans', list('installment_plans'), (r) => {
      const a = remap('accounts', r.account_id);
      return a ? { ...r, account_id: a, category_id: remap('categories', r.category_id) } : null;
    });
    insert('transactions', list('transactions'), (r) => {
      const a = remap('accounts', r.account_id);
      if (!a) return null;
      return {
        ...r,
        account_id: a,
        to_account_id: remap('accounts', r.to_account_id),
        category_id: remap('categories', r.category_id),
        recurring_id: remap('recurring_rules', r.recurring_id),
        installment_id: remap('installment_plans', r.installment_id),
        base_amount: r.base_amount ?? r.amount,
      };
    });
    const link = sqlite.prepare(`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)`);
    for (const l of list('transaction_tags')) {
      const t = remap('transactions', l.transaction_id);
      const g = remap('tags', l.tag_id);
      if (t && g) link.run(t, g);
    }
    insert('budgets', list('budgets'), (r) => (r.category_id == null ? r : { ...r, category_id: remap('categories', r.category_id) ?? undefined }));
    insert('templates', list('templates'), (r) => ({
      ...r,
      account_id: remap('accounts', r.account_id),
      to_account_id: remap('accounts', r.to_account_id),
      category_id: remap('categories', r.category_id),
    }));
    insert('goals', list('goals'), (r) => r);
    insert('goal_entries', list('goal_entries'), (r) => {
      const g = remap('goals', r.goal_id);
      return g ? { ...r, goal_id: g } : null;
    });
    const rateStmt = sqlite.prepare(`INSERT OR REPLACE INTO exchange_rates (user_id, currency, rate, updated_at) VALUES (?, ?, ?, ?)`);
    for (const r of list('exchange_rates')) rateStmt.run(uid, r.currency as string, Number(r.rate), (r.updated_at as string) ?? new Date().toISOString());
    counts.exchange_rates = list('exchange_rates').length;

    for (const a of list('attachments')) {
      const t = remap('transactions', a.transaction_id);
      if (t && typeof a.data === 'string') photos.push({ txId: t, buf: Buffer.from(a.data, 'base64') });
    }
  })();

  let photoCount = 0;
  for (const ph of photos) {
    try {
      storeAttachment(uid, ph.txId, ph.buf);
      photoCount++;
    } catch {
      /* skip invalid images */
    }
  }
  counts.attachments = photoCount;
  return counts;
}

/* ============================ Routes ============================ */
export async function dataRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/export/transactions', async (req, reply) => {
    const q = req.query as { format?: string; from?: string; to?: string };
    const rows = exportRows(req.user.uid, q.from, q.to);
    const stamp = format(new Date(), 'yyyyMMdd');
    if (q.format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      wb.creator = '薄荷記帳';
      const ws = wb.addWorksheet('記帳明細', { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = HEADERS.map((h, i) => ({ header: h, width: [18, 8, 12, 7, 14, 14, 12, 12, 12, 28, 18][i] }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
      rows.forEach((r) => ws.addRow(r));
      ws.getColumn(3).numFmt = '#,##0.##';
      ws.getColumn(7).numFmt = '#,##0.##';
      ws.autoFilter = { from: 'A1', to: 'K1' };
      const buf = await wb.xlsx.writeBuffer();
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="ledger-${stamp}.xlsx"`)
        .send(Buffer.from(buf as ArrayBuffer));
    }
    const csv = '﻿' + [HEADERS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="ledger-${stamp}.csv"`)
      .send(csv);
  });

  app.post('/api/import/preview', async (req) => {
    const part = await req.file();
    if (!part) throw new HttpError(400, '沒有收到檔案');
    const buf = await part.toBuffer();
    const name = part.filename.toLowerCase();
    const isXlsx = name.endsWith('.xlsx') || buf.subarray(0, 2).toString('ascii') === 'PK';
    const table = isXlsx ? await parseXlsx(buf) : parseCsv(buf.toString('utf8'));
    return preview(req.user.uid, toRows(table));
  });

  app.post('/api/import/commit', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const b = req.body as { rows?: ImportRow[]; skipDuplicates?: boolean };
    if (!Array.isArray(b?.rows)) throw new HttpError(400, '沒有可匯入的資料');
    const rows = b.rows.slice(0, 5000).map((r) => ({
      ...r,
      type: (['expense', 'income', 'transfer'].includes(r.type) ? r.type : 'expense') as TxType,
      amount: Number(r.amount),
      occurredAt: normDate(String(r.occurredAt ?? '').replace('T', ' ')) ?? '',
      account: String(r.account ?? '').slice(0, 30) || '現金',
      toAccount: r.toAccount ? String(r.toAccount).slice(0, 30) : null,
      category: r.category ? String(r.category).slice(0, 20) : null,
      subcategory: r.subcategory ? String(r.subcategory).slice(0, 20) : null,
      note: String(r.note ?? '').slice(0, 200),
      tags: Array.isArray(r.tags) ? r.tags.map((t) => String(t).slice(0, 20)).slice(0, 10) : [],
    }));
    return commit(req.user.uid, rows, b.skipDuplicates !== false);
  });

  app.get('/api/backup', async (req, reply) => {
    const withPhotos = (req.query as { photos?: string }).photos !== '0';
    const json = JSON.stringify(backup(req.user.uid, withPhotos));
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="mint-ledger-backup-${format(new Date(), 'yyyyMMdd-HHmm')}.json"`)
      .send(json);
  });

  app.post('/api/backup/restore', { bodyLimit: 200 * 1024 * 1024 }, async (req) => ({ ok: true, counts: restore(req.user.uid, req.body) }));
}
