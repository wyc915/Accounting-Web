import { sqlite } from './db/index.js';
import { HttpError } from './util.js';

const baseStmt = sqlite.prepare(`SELECT base_currency AS c FROM users WHERE id = ?`);
const rateStmt = sqlite.prepare(`SELECT rate FROM exchange_rates WHERE user_id = ? AND currency = ?`);
const accCurStmt = sqlite.prepare(`SELECT currency FROM accounts WHERE id = ? AND user_id = ?`);

export const baseCurrency = (uid: number) => ((baseStmt.get(uid) as { c: string } | undefined)?.c ?? 'TWD');

/** 1 unit of `currency` expressed in base currency. Throws when a foreign rate is missing. */
export function rateOf(uid: number, currency: string, strict = true): number {
  if (currency === baseCurrency(uid)) return 1;
  const r = rateStmt.get(uid, currency) as { rate: number } | undefined;
  if (!r) {
    if (strict) throw new HttpError(400, `尚未設定 ${currency} 匯率，請先到「設定 → 幣別與匯率」新增`);
    return 1;
  }
  return r.rate;
}

export const accountCurrency = (uid: number, accountId: number) =>
  ((accCurStmt.get(accountId, uid) as { currency: string } | undefined)?.currency ?? baseCurrency(uid));

/** amount in account currency (cents) → base currency (cents) */
export const toBase = (uid: number, accountId: number, cents: number, strict = true) =>
  Math.round(cents * rateOf(uid, accountCurrency(uid, accountId), strict));

/** transfer: amount received by `toAccountId` when not given explicitly (cents) */
export function convertBetween(uid: number, fromAccountId: number, toAccountId: number, cents: number) {
  const from = accountCurrency(uid, fromAccountId);
  const to = accountCurrency(uid, toAccountId);
  if (from === to) return cents;
  return Math.round((cents * rateOf(uid, from)) / rateOf(uid, to));
}

/** SQL fragment for "now" in local time, comparable with occurred_at */
export const NOW_LOCAL = `strftime('%Y-%m-%dT%H:%M','now','localtime')`;
