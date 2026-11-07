import {
  CURRENCY_CODES, baseCurrencyInput, lockSettingsInput, profileSchema, rateInput, type Currency, type ExchangeRate, type User,
} from '@ledger/shared';
import { z } from 'zod';
import { Ctx, hashPin, verifyPin } from '../ctx.js';
import { CoreError, parse, stamp } from '../util.js';

type Seed = { name: string; icon: string; color: string; children?: [string, string][] };
const EXPENSE: Seed[] = [
  { name: '餐飲', icon: 'utensils', color: '#f97316', children: [['早餐', 'croissant'], ['午餐', 'soup'], ['晚餐', 'utensils'], ['飲料', 'cup-soda'], ['點心', 'cookie']] },
  { name: '交通', icon: 'bus', color: '#3b82f6', children: [['大眾運輸', 'train-front'], ['計程車', 'car-taxi-front'], ['加油', 'fuel'], ['停車', 'square-parking']] },
  { name: '購物', icon: 'shopping-bag', color: '#ec4899', children: [['服飾', 'shirt'], ['3C', 'smartphone'], ['日用品', 'spray-can']] },
  { name: '娛樂', icon: 'gamepad-2', color: '#8b5cf6', children: [['電影', 'clapperboard'], ['旅遊', 'plane'], ['訂閱', 'tv']] },
  { name: '居家', icon: 'house', color: '#14b8a6', children: [['房租', 'key-round'], ['水電瓦斯', 'zap'], ['網路電話', 'wifi']] },
  { name: '醫療', icon: 'heart-pulse', color: '#ef4444' },
  { name: '教育', icon: 'graduation-cap', color: '#6366f1' },
  { name: '人情', icon: 'gift', color: '#f43f5e' },
  { name: '其他', icon: 'ellipsis', color: '#64748b' },
];
const INCOME: Seed[] = [
  { name: '薪資', icon: 'briefcase', color: '#10b981' },
  { name: '獎金', icon: 'trophy', color: '#f59e0b' },
  { name: '投資', icon: 'trending-up', color: '#0ea5e9' },
  { name: '兼職', icon: 'laptop', color: '#22c55e' },
  { name: '其他', icon: 'piggy-bank', color: '#64748b' },
];

export const onboardInput = z.object({
  name: z.string().trim().min(1, '請輸入暱稱').max(40),
  baseCurrency: z.enum(CURRENCY_CODES as [Currency, ...Currency[]]),
});
export const pinInput = z.object({ pin: z.string().regex(/^\d{4,6}$/, 'PIN 需為 4–6 位數字') });
export const pinChangeInput = z.object({ current: z.string().optional(), pin: z.string().regex(/^\d{4,6}$/, 'PIN 需為 4–6 位數字') });

/** App-level settings: profile, onboarding, PIN, biometrics, currency */
export function appService(ctx: Ctx) {
  const { sql } = ctx;

  async function me(): Promise<User> {
    return {
      id: 1,
      name: (await ctx.getSetting('name')) ?? '我',
      email: '',
      baseCurrency: await ctx.baseCurrency(),
      pinEnabled: !!(await ctx.getSetting('pin_hash')),
      lockMinutes: Number(await ctx.getSetting('lock_minutes')) || 1,
      biometric: (await ctx.getSetting('biometric')) === '1',
      onboarded: (await ctx.getSetting('onboarded')) === '1',
      locked: false,
    };
  }

  async function seed(base: Currency) {
    await sql.tx(async () => {
      for (const [list, type] of [[EXPENSE, 'expense'], [INCOME, 'income']] as const) {
        for (const [i, c] of list.entries()) {
          const id = await sql.insert('INSERT INTO categories (type, name, icon, color, sort) VALUES (?, ?, ?, ?, ?)', [type, c.name, c.icon, c.color, i]);
          for (const [j, [name, icon]] of (c.children ?? []).entries())
            await sql.run('INSERT INTO categories (parent_id, type, name, icon, color, sort) VALUES (?, ?, ?, ?, ?, ?)', [id, type, name, icon, c.color, j]);
        }
      }
      const now = stamp();
      for (const [i, [name, type, icon, color]] of [
        ['現金', 'cash', 'wallet', '#34d399'],
        ['銀行帳戶', 'bank', 'landmark', '#38bdf8'],
        ['信用卡', 'credit', 'credit-card', '#a78bfa'],
      ].entries())
        await sql.run('INSERT INTO accounts (name, type, icon, color, currency, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [name, type, icon, color, base, i, now]);
    });
  }

  return {
    me,

    /** first launch: name + base currency, seeds default categories/accounts */
    async onboard(body: unknown) {
      if ((await ctx.getSetting('onboarded')) === '1') return me();
      const b = parse(onboardInput, body);
      await ctx.setSetting('name', b.name);
      await ctx.setSetting('base_currency', b.baseCurrency);
      const hasData = await sql.get('SELECT id FROM accounts LIMIT 1');
      if (!hasData) await seed(b.baseCurrency);
      await ctx.setSetting('onboarded', '1');
      return me();
    },

    async updateProfile(body: unknown) {
      const b = parse(profileSchema, body);
      await ctx.setSetting('name', b.name);
      return me();
    },

    /* ---------- PIN ---------- */
    async setPin(body: unknown) {
      const b = parse(pinChangeInput, body);
      const cur = await ctx.getSetting('pin_hash');
      if (cur && !(b.current && (await verifyPin(b.current, cur)))) throw new CoreError(400, '目前的 PIN 不正確');
      await ctx.setSetting('pin_hash', await hashPin(b.pin));
      await ctx.setSetting('pin_fail', 0);
      return me();
    },
    async disablePin(body: unknown) {
      const { pin } = parse(pinInput, body);
      const cur = await ctx.getSetting('pin_hash');
      if (cur && !(await verifyPin(pin, cur))) throw new CoreError(400, 'PIN 不正確');
      await ctx.setSetting('pin_hash', null);
      await ctx.setSetting('biometric', null);
      return me();
    },
    /** throttled: every 5 wrong attempts locks for 5 minutes (persisted across restarts) */
    async verifyPin(body: unknown) {
      const { pin } = parse(pinInput, body);
      const until = Number(await ctx.getSetting('pin_until')) || 0;
      if (until > Date.now()) {
        const s = Math.ceil((until - Date.now()) / 1000);
        throw new CoreError(429, `嘗試次數過多，請 ${s} 秒後再試`);
      }
      const cur = await ctx.getSetting('pin_hash');
      if (!cur) return { ok: true };
      if (!(await verifyPin(pin, cur))) {
        const n = (Number(await ctx.getSetting('pin_fail')) || 0) + 1;
        await ctx.setSetting('pin_fail', n);
        if (n % 5 === 0) {
          await ctx.setSetting('pin_until', Date.now() + 5 * 60_000);
          throw new CoreError(400, 'PIN 錯誤次數過多，已鎖定 5 分鐘');
        }
        throw new CoreError(400, `PIN 錯誤（剩 ${5 - (n % 5)} 次）`);
      }
      await ctx.setSetting('pin_fail', 0);
      await ctx.setSetting('pin_until', null);
      return { ok: true };
    },
    async setLock(body: unknown) {
      const { lockMinutes } = parse(lockSettingsInput, body);
      await ctx.setSetting('lock_minutes', lockMinutes);
      return me();
    },
    async setBiometric(body: unknown) {
      const { enabled } = parse(z.object({ enabled: z.boolean() }), body);
      if (enabled && !(await ctx.getSetting('pin_hash'))) throw new CoreError(400, '請先設定 PIN，生物辨識作為快速解鎖');
      await ctx.setSetting('biometric', enabled ? '1' : null);
      return me();
    },

    /* ---------- Currency ---------- */
    async rates(): Promise<ExchangeRate[]> {
      return (await sql.all<{ currency: Currency; rate: number; updated_at: string }>('SELECT * FROM exchange_rates ORDER BY currency')).map((r) => ({
        currency: r.currency,
        rate: r.rate,
        updatedAt: r.updated_at,
      }));
    },
    async upsertRate(body: unknown) {
      const b = parse(rateInput, body);
      if (b.currency === (await ctx.baseCurrency())) throw new CoreError(400, '主要幣別不需設定匯率');
      await sql.run(
        'INSERT INTO exchange_rates (currency, rate, updated_at) VALUES (?, ?, ?) ON CONFLICT(currency) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at',
        [b.currency, b.rate, stamp()],
      );
      return { ok: true };
    },
    async deleteRate(currency: string) {
      const used = await sql.get<{ c: number }>('SELECT COUNT(*) c FROM accounts WHERE currency = ?', [currency]);
      if (used?.c) throw new CoreError(409, `仍有 ${used.c} 個帳戶使用 ${currency}，無法刪除匯率`);
      await sql.run('DELETE FROM exchange_rates WHERE currency = ?', [currency]);
      return { ok: true };
    },
    async setBaseCurrency(body: unknown) {
      const { baseCurrency: next } = parse(baseCurrencyInput, body);
      const cur = await ctx.baseCurrency();
      if (next === cur) return { ok: true };
      const foreign = await sql.get<{ c: number }>('SELECT COUNT(*) c FROM accounts WHERE currency <> ?', [cur]);
      if (foreign?.c) throw new CoreError(409, '已有外幣帳戶時無法變更主要幣別');
      await sql.tx(async () => {
        await ctx.setSetting('base_currency', next);
        await sql.run('UPDATE accounts SET currency = ?', [next]);
        await sql.run('DELETE FROM exchange_rates');
      });
      return { ok: true };
    },
  };
}
