import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CURRENCIES, type Currency } from '@ledger/shared';

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

const nf = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });

/** user's base currency — set once /auth/me resolves */
let BASE: Currency = 'TWD';
export const setBaseCurrency = (c: Currency) => (BASE = c);
export const getBaseCurrency = () => BASE;
export const symbolOf = (c?: Currency) => CURRENCIES[c ?? BASE]?.symbol ?? '$';

/** money(1234.5) → "$1,234.5" in base currency; pass `currency` for account-currency amounts */
export const money = (n: number, opts?: { sign?: boolean; currency?: Currency }) => {
  const s = nf.format(Math.abs(n));
  const sym = symbolOf(opts?.currency);
  if (opts?.sign) return `${n < 0 ? '−' : n > 0 ? '+' : ''}${sym}${s}`;
  return `${n < 0 ? '−' : ''}${sym}${s}`;
};

export const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
export const toLocalDT = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");
export const parseDT = (s: string) => parseISO(s);

export const dayLabel = (s: string) => {
  const d = parseISO(s);
  if (isToday(d)) return '今天';
  if (isYesterday(d)) return '昨天';
  return format(d, 'M月d日 EEEE', { locale: zhTW });
};
export const fmt = (d: Date, f: string) => format(d, f, { locale: zhTW });
