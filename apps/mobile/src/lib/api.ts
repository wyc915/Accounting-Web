/**
 * Local "API": the UI keeps calling api.get('/accounts') etc., but requests are routed
 * in-process to the on-device core (no network, no server).
 */
import { format } from 'date-fns';
import { CoreError, type Core } from '@ledger/core';
import { getCore } from './db';
import { saveFile, toBase64 } from './native';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Q = Record<string, string>;
type Handler = (core: Core, m: string[], q: Q, body: unknown) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp('^' + path.replace(/:\w+/g, '([^/]+)') + '$'), h]);
const id = (s: string) => Number(s);

/* ---------- app / security ---------- */
on('GET', '/auth/me', (c) => c.app.me());
on('PATCH', '/auth/me', (c, _m, _q, b) => c.app.updateProfile(b));
on('POST', '/app/onboard', (c, _m, _q, b) => c.app.onboard(b));
on('POST', '/auth/pin', (c, _m, _q, b) => c.app.setPin(b));
on('DELETE', '/auth/pin', (c, _m, _q, b) => c.app.disablePin(b));
on('POST', '/auth/pin/verify', (c, _m, _q, b) => c.app.verifyPin(b));
on('PUT', '/auth/lock-settings', (c, _m, _q, b) => c.app.setLock(b));
on('PUT', '/app/biometric', (c, _m, _q, b) => c.app.setBiometric(b));
on('POST', '/app/recurring/process', (c) => c.recurring.process());
/* ---------- accounts / categories / tags ---------- */
on('GET', '/accounts', (c) => c.accounts.list());
on('POST', '/accounts', (c, _m, _q, b) => c.accounts.create(b));
on('PUT', '/accounts/reorder', (c, _m, _q, b) => c.accounts.reorder(b));
on('GET', '/accounts/:id/cycle', (c, m) => c.accounts.cycle(id(m[0])));
on('PUT', '/accounts/:id', (c, m, _q, b) => c.accounts.update(id(m[0]), b));
on('DELETE', '/accounts/:id', (c, m) => c.accounts.remove(id(m[0])));
on('GET', '/categories', (c) => c.categories.list());
on('POST', '/categories', (c, _m, _q, b) => c.categories.create(b));
on('PUT', '/categories/reorder', (c, _m, _q, b) => c.categories.reorder(b));
on('PUT', '/categories/:id', (c, m, _q, b) => c.categories.update(id(m[0]), b));
on('DELETE', '/categories/:id', (c, m) => c.categories.remove(id(m[0])));
on('GET', '/tags', (c) => c.categories.tags());
on('POST', '/tags', (c, _m, _q, b) => c.categories.createTag(b));
on('DELETE', '/tags/:id', (c, m) => c.categories.removeTag(id(m[0])));
/* ---------- transactions ---------- */
on('GET', '/transactions', (c, _m, q) => c.transactions.list(q));
on('GET', '/transactions/summary', (c, _m, q) => c.transactions.summary(q));
on('POST', '/transactions', (c, _m, _q, b) => c.transactions.create(b));
on('PUT', '/transactions/:id', (c, m, _q, b) => c.transactions.update(id(m[0]), b));
on('DELETE', '/transactions/:id', (c, m) => c.transactions.remove(id(m[0])));
on('POST', '/transactions/:id/restore', (c, m) => c.transactions.restore(id(m[0])));
on('GET', '/attachments/:id', (c, m) => c.transactions.getAttachment(id(m[0])));
on('DELETE', '/attachments/:id', (c, m) => c.transactions.removeAttachment(id(m[0])));
/* ---------- stats / budgets / recurring ---------- */
on('GET', '/stats/trend', (c, _m, q) => c.stats.trend(q));
on('GET', '/stats/categories', (c, _m, q) => c.stats.categories(q));
on('GET', '/budgets', (c, _m, q) => c.stats.budgets(q.month));
on('PUT', '/budgets', (c, _m, _q, b) => c.stats.upsertBudget(b));
on('DELETE', '/budgets/:id', (c, m) => c.stats.removeBudget(id(m[0])));
on('GET', '/recurring', (c) => c.recurring.list());
on('POST', '/recurring', (c, _m, _q, b) => c.recurring.create(b));
on('PUT', '/recurring/:id', (c, m, _q, b) => c.recurring.update(id(m[0]), b));
on('DELETE', '/recurring/:id', (c, m) => c.recurring.remove(id(m[0])));
/* ---------- templates / goals / installments ---------- */
on('GET', '/templates', (c) => c.templates.list());
on('POST', '/templates', (c, _m, _q, b) => c.templates.create(b));
on('PUT', '/templates/reorder', (c, _m, _q, b) => c.templates.reorder(b));
on('PUT', '/templates/:id', (c, m, _q, b) => c.templates.update(id(m[0]), b));
on('DELETE', '/templates/:id', (c, m) => c.templates.remove(id(m[0])));
on('GET', '/goals', (c) => c.goals.list());
on('POST', '/goals', (c, _m, _q, b) => c.goals.create(b));
on('PUT', '/goals/:id', (c, m, _q, b) => c.goals.update(id(m[0]), b));
on('DELETE', '/goals/:id', (c, m) => c.goals.remove(id(m[0])));
on('GET', '/goals/:id/entries', (c, m) => c.goals.entries(id(m[0])));
on('POST', '/goals/:id/entries', (c, m, _q, b) => c.goals.addEntry(id(m[0]), b));
on('DELETE', '/goals/:id/entries/:entryId', (c, m) => c.goals.removeEntry(id(m[0]), id(m[1])));
on('GET', '/installments', (c) => c.installments.list());
on('POST', '/installments', (c, _m, _q, b) => c.installments.create(b));
on('DELETE', '/installments/:id', (c, m, q) => c.installments.remove(id(m[0]), q.mode === 'all' ? 'all' : 'future'));
/* ---------- currency ---------- */
on('GET', '/rates', (c) => c.app.rates());
on('PUT', '/rates', (c, _m, _q, b) => c.app.upsertRate(b));
on('DELETE', '/rates/:currency', (c, m) => c.app.deleteRate(decodeURIComponent(m[0])));
on('PUT', '/settings/base-currency', (c, _m, _q, b) => c.app.setBaseCurrency(b));
/* ---------- data ---------- */
on('POST', '/import/commit', (c, _m, _q, b) => c.data.importCommit(b as never));
on('POST', '/backup/restore', (c, _m, _q, b) => {
  const { text, password } = b as { text: string; password?: string };
  return c.data.restore(text, password);
});

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const [path, query = ''] = url.split('?');
  const q = Object.fromEntries(new URLSearchParams(query)) as Q;
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = path.match(re);
    if (!match) continue;
    try {
      const core = await getCore();
      return (await h(core, match.slice(1), q, body)) as T;
    } catch (e) {
      if (e instanceof CoreError) throw new ApiError(e.status, e.message);
      console.error(e);
      throw new ApiError(500, (e as Error)?.message || '發生錯誤');
    }
  }
  throw new ApiError(404, `未知的操作：${method} ${path}`);
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),

  /** file → core (receipt photo or import file) */
  async upload<T>(url: string, file: Blob, name = 'file'): Promise<T> {
    const core = await getCore();
    try {
      const att = url.match(/^\/transactions\/(\d+)\/attachments$/);
      if (att) return (await core.transactions.addAttachment(Number(att[1]), await toBase64(file))) as T;
      if (url === '/import/preview') {
        if (file.size > 10 * 1024 * 1024) throw new CoreError(400, '檔案不可超過 10MB');
        const xlsx = name.toLowerCase().endsWith('.xlsx');
        return (await core.data.importPreview(xlsx ? { name, bytes: await file.arrayBuffer() } : { name, text: await file.text() })) as T;
      }
    } catch (e) {
      if (e instanceof CoreError) throw new ApiError(e.status, e.message);
      throw e;
    }
    throw new ApiError(404, `未知的上傳：${url}`);
  },

  /** generate an export / backup and hand it to the share sheet (or download on web) */
  async download(url: string, _fallback: string, opts: { password?: string } = {}) {
    const core = await getCore();
    const [path, query = ''] = url.split('?');
    const q = Object.fromEntries(new URLSearchParams(query));
    const stampDay = format(new Date(), 'yyyyMMdd');
    if (path === '/export/transactions') {
      if (q.format === 'xlsx') {
        const bytes = await core.data.exportXlsx(q.from, q.to);
        return saveFile(`diandi-${stampDay}.xlsx`, new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      }
      return saveFile(`diandi-${stampDay}.csv`, new Blob([await core.data.exportCsv(q.from, q.to)], { type: 'text/csv' }));
    }
    if (path === '/backup') {
      const text = await core.data.backup({ photos: q.photos !== '0', password: opts.password });
      const name = `diandi-backup-${format(new Date(), 'yyyyMMdd-HHmm')}.${opts.password ? 'diandi' : 'json'}`;
      return saveFile(name, new Blob([text], { type: opts.password ? 'application/octet-stream' : 'application/json' }));
    }
    throw new ApiError(404, `未知的匯出：${url}`);
  },
};

export const qs = (o: Record<string, string | number | undefined | null | (string | number)[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Resize/compress a photo before storing (max 1600px, JPEG ~0.82) */
export async function compressImage(file: File, max = 1600): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  return blob && blob.size < file.size ? blob : file;
}

/** object URL for a stored receipt photo (cached) */
const photoCache = new Map<number, Promise<string>>();
export function attachmentUrl(attId: number): Promise<string> {
  if (!photoCache.has(attId))
    photoCache.set(
      attId,
      (async () => {
        const a = await api.get<{ mime: string; data: string }>(`/attachments/${attId}`);
        const bin = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0));
        return URL.createObjectURL(new Blob([bin], { type: a.mime }));
      })(),
    );
  return photoCache.get(attId)!;
}
