import type { Currency } from '@ledger/shared';
import { Sql } from './db.js';
import { CoreError } from './util.js';

/** Shared context: settings store + currency conversion. Passed to every service. */
export class Ctx {
  constructor(public readonly sql: Sql) {}

  async getSetting(key: string): Promise<string | null> {
    return (await this.sql.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]))?.value ?? null;
  }
  async setSetting(key: string, value: string | number | boolean | null) {
    if (value == null) return this.sql.run('DELETE FROM settings WHERE key = ?', [key]);
    return this.sql.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      key,
      String(value),
    ]);
  }

  async baseCurrency(): Promise<Currency> {
    return ((await this.getSetting('base_currency')) ?? 'TWD') as Currency;
  }

  /** 1 unit of `currency` in base currency. strict=false → missing rate falls back to 1. */
  async rateOf(currency: string, strict = true): Promise<number> {
    if (currency === (await this.baseCurrency())) return 1;
    const r = await this.sql.get<{ rate: number }>('SELECT rate FROM exchange_rates WHERE currency = ?', [currency]);
    if (!r) {
      if (strict) throw new CoreError(400, `尚未設定 ${currency} 匯率，請先到「設定 → 幣別與匯率」新增`);
      return 1;
    }
    return r.rate;
  }

  async accountCurrency(accountId: number): Promise<string> {
    return (await this.sql.get<{ currency: string }>('SELECT currency FROM accounts WHERE id = ?', [accountId]))?.currency ?? (await this.baseCurrency());
  }

  /** account-currency cents → base-currency cents */
  async toBase(accountId: number, cents: number, strict = true) {
    return Math.round(cents * (await this.rateOf(await this.accountCurrency(accountId), strict)));
  }

  /** transfer amount received by `to` when not given explicitly */
  async convertBetween(fromAccount: number, toAccount: number, cents: number) {
    const a = await this.accountCurrency(fromAccount);
    const b = await this.accountCurrency(toAccount);
    if (a === b) return cents;
    return Math.round((cents * (await this.rateOf(a))) / (await this.rateOf(b)));
  }

  async assertAccount(id: number) {
    if (!(await this.sql.get('SELECT id FROM accounts WHERE id = ?', [id]))) throw new CoreError(400, '帳戶不存在');
  }
  async assertCategory(id: number, type: string) {
    const c = await this.sql.get<{ type: string }>('SELECT type FROM categories WHERE id = ?', [id]);
    if (!c) throw new CoreError(404, '類別不存在');
    if (c.type !== type) throw new CoreError(400, '類別與收支類型不符');
  }
}

/* ---------- PIN hashing (PBKDF2-SHA256 via WebCrypto; works in WebView and Node 20) ---------- */
const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITER = 150_000;

async function derive(pin: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITER }, key, 256);
}
export async function hashPin(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${ITER}:${b64(salt)}:${b64(await derive(pin, salt))}`;
}
export async function verifyPin(pin: string, stored: string) {
  const [, salt, hash] = stored.split(':');
  const got = b64(await derive(pin, unb64(salt)));
  // constant-time-ish compare
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
export { b64, unb64 };
