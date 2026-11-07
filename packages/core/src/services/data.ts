import { format } from 'date-fns';
import { CURRENCY_CODES, type ImportPreview, type ImportRow, type TxType } from '@ledger/shared';
import type { Ctx } from '../ctx.js';
import { b64, unb64 } from '../ctx.js';
import { placeholders, type Param } from '../db.js';
import { CoreError, fromCents, stamp, toCents } from '../util.js';
import { sniffBase64 } from './transactions.js';

const TYPE_LABEL: Record<TxType, string> = { expense: '支出', income: '收入', transfer: '轉帳' };
const HEADERS = ['日期', '類型', '金額', '幣別', '帳戶', '轉入帳戶', '轉入金額', '類別', '子類別', '備註', '標籤'];
export const BACKUP_APP_ID = 'diandi-ledger';
const ACCEPTED_APP_IDS = [BACKUP_APP_ID, 'mint-ledger'];

/* ============================ CSV / XLSX parsing ============================ */
export function parseCsv(text: string): string[][] {
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

async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    out.push(
      (r.values as unknown[]).slice(1).map((v) => {
        if (v instanceof Date) return format(new Date(v.getTime() + v.getTimezoneOffset() * 60000), 'yyyy-MM-dd HH:mm');
        if (v && typeof v === 'object') {
          const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
          if (o.richText) return o.richText.map((t) => t.text).join('');
          if (o.text) return o.text;
          if (o.result != null) return String(o.result);
        }
        return v == null ? '' : String(v);
      }),
    );
  });
  return out;
}

const ALIASES: Record<string, string[]> = {
  date: ['日期', '時間', '交易日期', 'date', 'datetime', 'time'],
  type: ['類型', '收支', 'type'],
  amount: ['金額', 'amount', 'value'],
  account: ['帳戶', 'account', '付款方式'],
  toAccount: ['轉入帳戶', 'to account', 'toaccount'],
  category: ['類別', '分類', 'category'],
  sub: ['子類別', '子分類', 'subcategory'],
  note: ['備註', '說明', '描述', 'note', 'memo', 'description'],
  tags: ['標籤', 'tags', 'tag'],
};

export function normDate(s: string): string | null {
  s = s.trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
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
  if (table.length < 2) throw new CoreError(400, '檔案沒有資料列');
  const head = table[0].map((h) => h.trim().toLowerCase());
  const idx = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, head.findIndex((h) => ALIASES[k].includes(h))]));
  if (idx.date < 0 || idx.amount < 0) throw new CoreError(400, '找不到「日期」或「金額」欄位，請確認第一列為標題');
  const get = (r: string[], k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
  return table.slice(1, 5001).map((r, i) => {
    const rawAmt = get(r, 'amount').replace(/[,\s$¥€£₩฿₫₱]|NT|US|HK|CN|A\$|S\$/gi, '');
    const n = parseFloat(rawAmt.replace(/^\((.*)\)$/, '-$1'));
    const t = get(r, 'type').toLowerCase();
    let type: TxType =
      /轉|transfer/.test(t) ? 'transfer' : /收|income|in$/.test(t) ? 'income' : /支|expense|out$/.test(t) ? 'expense' : n < 0 ? 'expense' : 'income';
    if (!t && !(n < 0)) type = 'expense';
    const occurredAt = normDate(get(r, 'date'));
    const row: ImportRow = {
      line: i + 2,
      occurredAt: occurredAt ?? '',
      type,
      amount: Math.abs(n),
      account: get(r, 'account') || '現金',
      toAccount: get(r, 'toAccount') || null,
      category: get(r, 'category') || null,
      subcategory: get(r, 'sub') || null,
      note: get(r, 'note').slice(0, 200),
      tags: get(r, 'tags').split(/[\s,，、]+/).map((x) => x.replace(/^#/, '').trim()).filter(Boolean).slice(0, 10),
    };
    if (!occurredAt) row.error = '日期格式無法辨識';
    else if (!(row.amount > 0)) row.error = '金額無效';
    else if (type === 'transfer' && !row.toAccount) row.error = '轉帳缺少轉入帳戶';
    else if (type === 'transfer' && row.toAccount === row.account) row.error = '轉出與轉入帳戶相同';
    return row;
  });
}

/* ============================ backup encryption ============================ */
const ENC_PREFIX = 'DIANDI-ENC1:';
async function deriveKey(password: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 210_000 },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptText(text: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(password, salt), new TextEncoder().encode(text)));
  const all = new Uint8Array(salt.length + iv.length + ct.length);
  all.set(salt, 0);
  all.set(iv, 16);
  all.set(ct, 28);
  return ENC_PREFIX + b64(all);
}
export async function decryptText(payload: string, password: string) {
  const all = unb64(payload.slice(ENC_PREFIX.length));
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(16, 28) }, await deriveKey(password, all.slice(0, 16)), all.slice(28));
    return new TextDecoder().decode(pt);
  } catch {
    throw new CoreError(400, '備份密碼不正確，或檔案已損毀');
  }
}
export const isEncrypted = (text: string) => text.startsWith(ENC_PREFIX);

/* ============================ service ============================ */
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
type Rec = Record<string, unknown>;

export function dataService(ctx: Ctx) {
  const { sql } = ctx;

  async function exportRows(from?: string, to?: string) {
    const w = ['t.deleted_at IS NULL'];
    const p: Param[] = [];
    if (from) (w.push('t.occurred_at >= ?'), p.push(from));
    if (to) (w.push('t.occurred_at < ?'), p.push(to));
    const rows = await sql.all<Record<string, string | number | null>>(
      `SELECT t.occurred_at, t.type, t.amount, t.to_amount, t.note, a.name account, a.currency, ta.name to_account,
         COALESCE(p.name, c.name) category, CASE WHEN p.id IS NOT NULL THEN c.name END sub,
         (SELECT GROUP_CONCAT(g.name, ' ') FROM transaction_tags x JOIN tags g ON g.id = x.tag_id WHERE x.transaction_id = t.id) tags
       FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN accounts ta ON ta.id = t.to_account_id
       LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
       WHERE ${w.join(' AND ')} ORDER BY t.occurred_at, t.id`,
      p,
    );
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
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`; // formula-injection guard
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  async function preview(rows: ImportRow[]): Promise<ImportPreview> {
    const accs = new Set((await sql.all<{ name: string }>('SELECT name FROM accounts')).map((a) => a.name));
    const cats = await sql.all<{ name: string; type: string; parent: string | null }>(
      'SELECT c.name, c.type, p.name parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id',
    );
    const catKey = new Set(cats.map((c) => `${c.type}|${c.parent ?? ''}|${c.name}`));
    const tags = new Set((await sql.all<{ name: string }>('SELECT name FROM tags')).map((t) => t.name));
    const newAccounts = new Set<string>();
    const newCategories = new Set<string>();
    const newTags = new Set<string>();
    for (const r of rows.filter((x) => !x.error)) {
      for (const a of [r.account, r.toAccount]) if (a && !accs.has(a)) newAccounts.add(a);
      if (r.type !== 'transfer' && r.category) {
        if (!catKey.has(`${r.type}||${r.category}`)) newCategories.add(`${TYPE_LABEL[r.type]}：${r.category}`);
        if (r.subcategory && !catKey.has(`${r.type}|${r.category}|${r.subcategory}`)) newCategories.add(`${TYPE_LABEL[r.type]}：${r.category} › ${r.subcategory}`);
      }
      for (const t of r.tags) if (!tags.has(t)) newTags.add(t);
    }
    return { rows, newAccounts: [...newAccounts], newCategories: [...newCategories], newTags: [...newTags] };
  }

  return {
    async exportCsv(from?: string, to?: string) {
      const rows = await exportRows(from, to);
      return '﻿' + [HEADERS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    },
    async exportXlsx(from?: string, to?: string): Promise<Uint8Array> {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = '點滴記帳';
      const ws = wb.addWorksheet('記帳明細', { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = HEADERS.map((h, i) => ({ header: h, width: [18, 8, 12, 7, 14, 14, 12, 12, 12, 28, 18][i] }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
      (await exportRows(from, to)).forEach((r) => ws.addRow(r));
      ws.getColumn(3).numFmt = '#,##0.##';
      ws.getColumn(7).numFmt = '#,##0.##';
      ws.autoFilter = { from: 'A1', to: 'K1' };
      return new Uint8Array(await wb.xlsx.writeBuffer());
    },

    /** file contents → preview (csv text or xlsx bytes) */
    async importPreview(file: { name: string; text?: string; bytes?: ArrayBuffer }) {
      const isXlsx = file.name.toLowerCase().endsWith('.xlsx') && file.bytes;
      const table = isXlsx ? await parseXlsx(file.bytes!) : parseCsv(file.text ?? '');
      return preview(toRows(table));
    },

    async importCommit(body: { rows?: ImportRow[]; skipDuplicates?: boolean }) {
      if (!Array.isArray(body?.rows)) throw new CoreError(400, '沒有可匯入的資料');
      const base = await ctx.baseCurrency();
      let created = 0;
      let skipped = 0;
      await sql.tx(async () => {
        const accId = async (name: string) => {
          const a = await sql.get<{ id: number }>('SELECT id FROM accounts WHERE name = ?', [name]);
          if (a) return a.id;
          const s = await sql.get<{ s: number }>('SELECT COALESCE(MAX(sort), -1) + 1 s FROM accounts');
          return sql.insert(`INSERT INTO accounts (name, type, icon, color, currency, sort, created_at) VALUES (?, 'other', 'wallet', '#64748b', ?, ?, ?)`, [name, base, s!.s, stamp()]);
        };
        const catId = async (type: string, name: string, parentId: number | null) => {
          const c = await sql.get<{ id: number }>('SELECT id FROM categories WHERE type = ? AND name = ? AND parent_id IS ?', [type, name, parentId]);
          if (c) return c.id;
          const color = parentId ? (await sql.get<{ color: string }>('SELECT color FROM categories WHERE id = ?', [parentId]))!.color : '#64748b';
          return sql.insert(`INSERT INTO categories (parent_id, type, name, icon, color, sort) VALUES (?, ?, ?, 'tag', ?, 999)`, [parentId, type, name, color]);
        };
        const tagId = async (name: string) =>
          (await sql.get<{ id: number }>('SELECT id FROM tags WHERE name = ?', [name]))?.id ?? sql.insert(`INSERT INTO tags (name, color) VALUES (?, '#94a3b8')`, [name]);

        for (const raw of body.rows!.slice(0, 5000)) {
          const occurredAt = normDate(String(raw.occurredAt ?? '').replace('T', ' '));
          const amountNum = Number(raw.amount);
          const type = (['expense', 'income', 'transfer'].includes(raw.type) ? raw.type : 'expense') as TxType;
          if (raw.error || !occurredAt || !(amountNum > 0)) continue;
          const note = String(raw.note ?? '').slice(0, 200);
          const a = await accId(String(raw.account || '現金').slice(0, 30));
          const amount = toCents(amountNum);
          if (body.skipDuplicates !== false) {
            const dup = await sql.get(
              'SELECT 1 FROM transactions WHERE deleted_at IS NULL AND occurred_at = ? AND type = ? AND amount = ? AND account_id = ? AND note = ? LIMIT 1',
              [occurredAt, type, amount, a, note],
            );
            if (dup) {
              skipped++;
              continue;
            }
          }
          let to: number | null = null;
          let toAmount: number | null = null;
          let cat: number | null = null;
          if (type === 'transfer') {
            if (!raw.toAccount) continue;
            to = await accId(String(raw.toAccount).slice(0, 30));
            if (to === a) continue;
            toAmount = await ctx.convertBetween(a, to, amount);
          } else if (raw.category) {
            const p = await catId(type, String(raw.category).slice(0, 20), null);
            cat = raw.subcategory ? await catId(type, String(raw.subcategory).slice(0, 20), p) : p;
          }
          const now = stamp();
          const id = await sql.insert(
            `INSERT INTO transactions (type, amount, base_amount, account_id, to_account_id, to_amount, category_id, occurred_at, note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [type, amount, await ctx.toBase(a, amount, false), a, to, toAmount, cat, occurredAt, note, now, now],
          );
          for (const t of (Array.isArray(raw.tags) ? raw.tags : []).slice(0, 10))
            await sql.run('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', [id, await tagId(String(t).slice(0, 20))]);
          created++;
        }
      });
      return { created, skipped };
    },

    /** full backup as JSON text (optionally password-encrypted) */
    async backup(opts: { photos?: boolean; password?: string } = {}) {
      const data: Record<string, unknown[]> = {};
      for (const [t, cols] of Object.entries(TABLES))
        data[t] = await sql.all(`SELECT ${cols} FROM ${t}${t === 'transactions' ? ' WHERE deleted_at IS NULL' : ''}`);
      data.transaction_tags = await sql.all(
        'SELECT x.transaction_id, x.tag_id FROM transaction_tags x JOIN transactions t ON t.id = x.transaction_id WHERE t.deleted_at IS NULL',
      );
      data.attachments =
        opts.photos === false
          ? []
          : await sql.all('SELECT a.transaction_id, a.mime, a.data FROM attachments a JOIN transactions t ON t.id = a.transaction_id WHERE t.deleted_at IS NULL');
      const settings = {
        base_currency: await ctx.baseCurrency(),
        lock_minutes: Number(await ctx.getSetting('lock_minutes')) || 1,
        name: await ctx.getSetting('name'),
      };
      const json = JSON.stringify({ app: BACKUP_APP_ID, version: 1, exportedAt: new Date().toISOString(), settings, data });
      return opts.password ? encryptText(json, opts.password) : json;
    },

    /** replaces ALL data with the backup (web-version backups are accepted too) */
    async restore(text: string, password?: string) {
      if (isEncrypted(text)) {
        if (!password) throw new CoreError(401, '此備份已加密，請輸入備份密碼');
        text = await decryptText(text, password);
      }
      let p: { app?: string; version?: number; settings?: Rec; data?: Record<string, Rec[]> };
      try {
        p = JSON.parse(text);
      } catch {
        throw new CoreError(400, '不是有效的備份檔');
      }
      if (!ACCEPTED_APP_IDS.includes(p?.app ?? '') || p.version !== 1 || !p.data) throw new CoreError(400, '不是有效的點滴記帳備份檔');
      const d = p.data;
      const base = String(p.settings?.base_currency ?? 'TWD');
      if (!CURRENCY_CODES.includes(base as never)) throw new CoreError(400, '備份檔幣別無效');
      const list = (k: string) => (Array.isArray(d[k]) ? d[k] : []);
      const counts: Record<string, number> = {};

      await sql.tx(async () => {
        for (const t of ['attachments', 'transaction_tags', 'transactions', 'installment_plans', 'recurring_rules', 'templates', 'budgets', 'goal_entries', 'goals', 'tags', 'exchange_rates'])
          await sql.run(`DELETE FROM ${t}`);
        await sql.run('UPDATE categories SET parent_id = NULL');
        await sql.run('DELETE FROM categories');
        await sql.run('DELETE FROM accounts');
        await ctx.setSetting('base_currency', base);
        await ctx.setSetting('lock_minutes', Number(p.settings?.lock_minutes) || 1);
        if (p.settings?.name) await ctx.setSetting('name', String(p.settings.name).slice(0, 40));
        await ctx.setSetting('onboarded', '1');

        const maps: Record<string, Map<number, number>> = {};
        const remap = (t: string, id: unknown) => (id == null ? null : (maps[t]?.get(Number(id)) ?? null));
        const insert = async (table: keyof typeof TABLES, rows: Rec[], fix: (r: Rec) => Rec | null) => {
          const cols = TABLES[table].split(',').filter((c) => c !== 'id');
          maps[table] ??= new Map();
          let n = 0;
          for (const raw of rows) {
            const r = fix({ ...raw });
            if (!r) continue;
            const id = await sql.insert(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders(cols.length)})`, cols.map((c) => (r[c] === undefined ? null : r[c]) as Param));
            if (raw.id != null) maps[table].set(Number(raw.id), id);
            n++;
          }
          counts[table] = (counts[table] ?? 0) + n;
        };
        await insert('accounts', list('accounts'), (r) => ({ ...r, currency: r.currency ?? base }));
        const cats = list('categories');
        await insert('categories', cats.filter((c) => c.parent_id == null), (r) => r);
        await insert('categories', cats.filter((c) => c.parent_id != null), (r) => ({ ...r, parent_id: remap('categories', r.parent_id) }));
        await insert('tags', list('tags'), (r) => r);
        await insert('recurring_rules', list('recurring_rules'), (r) => {
          const a = remap('accounts', r.account_id);
          return a ? { ...r, account_id: a, to_account_id: remap('accounts', r.to_account_id), category_id: remap('categories', r.category_id) } : null;
        });
        await insert('installment_plans', list('installment_plans'), (r) => {
          const a = remap('accounts', r.account_id);
          return a ? { ...r, account_id: a, category_id: remap('categories', r.category_id) } : null;
        });
        await insert('transactions', list('transactions'), (r) => {
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
        for (const l of list('transaction_tags')) {
          const t = remap('transactions', l.transaction_id);
          const g = remap('tags', l.tag_id);
          if (t && g) await sql.run('INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)', [t, g]);
        }
        await insert('budgets', list('budgets'), (r) => (r.category_id == null ? r : remap('categories', r.category_id) ? { ...r, category_id: remap('categories', r.category_id) } : null));
        await insert('templates', list('templates'), (r) => ({
          ...r,
          account_id: remap('accounts', r.account_id),
          to_account_id: remap('accounts', r.to_account_id),
          category_id: remap('categories', r.category_id),
        }));
        await insert('goals', list('goals'), (r) => r);
        await insert('goal_entries', list('goal_entries'), (r) => {
          const g = remap('goals', r.goal_id);
          return g ? { ...r, goal_id: g } : null;
        });
        for (const r of list('exchange_rates'))
          if (r.currency !== base)
            await sql.run('INSERT OR REPLACE INTO exchange_rates (currency, rate, updated_at) VALUES (?, ?, ?)', [String(r.currency), Number(r.rate), String(r.updated_at ?? stamp())]);
        counts.exchange_rates = list('exchange_rates').length;
        let photos = 0;
        for (const a of list('attachments')) {
          const t = remap('transactions', a.transaction_id);
          if (!t || typeof a.data !== 'string' || !sniffBase64(a.data)) continue;
          await sql.run('INSERT INTO attachments (transaction_id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)', [
            t, sniffBase64(a.data)!, Math.floor((a.data.length * 3) / 4), a.data, stamp(),
          ]);
          photos++;
        }
        counts.attachments = photos;
      });
      return counts;
    },
  };
}
