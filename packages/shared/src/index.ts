import { z } from 'zod';

/* ---------- Enums ---------- */
export const TX_TYPES = ['expense', 'income', 'transfer'] as const;
export type TxType = (typeof TX_TYPES)[number];

export const CATEGORY_TYPES = ['expense', 'income'] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const ACCOUNT_TYPES = ['cash', 'bank', 'credit', 'ewallet', 'other'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: '現金',
  bank: '銀行',
  credit: '信用卡',
  ewallet: '電子支付',
  other: '其他',
};

const ymdRe = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Currencies ---------- */
export const CURRENCIES = {
  TWD: { name: '新台幣', symbol: '$', digits: 0 },
  USD: { name: '美元', symbol: 'US$', digits: 2 },
  JPY: { name: '日圓', symbol: '¥', digits: 0 },
  EUR: { name: '歐元', symbol: '€', digits: 2 },
  CNY: { name: '人民幣', symbol: 'CN¥', digits: 2 },
  HKD: { name: '港幣', symbol: 'HK$', digits: 2 },
  KRW: { name: '韓元', symbol: '₩', digits: 0 },
  GBP: { name: '英鎊', symbol: '£', digits: 2 },
  AUD: { name: '澳幣', symbol: 'A$', digits: 2 },
  CAD: { name: '加幣', symbol: 'C$', digits: 2 },
  SGD: { name: '新加坡幣', symbol: 'S$', digits: 2 },
  THB: { name: '泰銖', symbol: '฿', digits: 2 },
  MYR: { name: '馬幣', symbol: 'RM', digits: 2 },
  VND: { name: '越南盾', symbol: '₫', digits: 0 },
  PHP: { name: '菲律賓披索', symbol: '₱', digits: 2 },
  CHF: { name: '瑞士法郎', symbol: 'CHF ', digits: 2 },
  NZD: { name: '紐幣', symbol: 'NZ$', digits: 2 },
} as const;
export type Currency = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];
const currencyEnum = z.enum(CURRENCY_CODES as [Currency, ...Currency[]]);

/* ---------- Auth ---------- */
export const registerSchema = z.object({
  name: z.string().trim().min(1, '請輸入名稱').max(40),
  email: z.string().trim().toLowerCase().email('Email 格式不正確'),
  password: z.string().min(8, '密碼至少 8 碼').max(100),
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email 格式不正確'),
  password: z.string().min(1, '請輸入密碼'),
});
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(40),
});
export const passwordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(8, '新密碼至少 8 碼').max(100),
});

/* ---------- Accounts ---------- */
export const accountInput = z.object({
  name: z.string().trim().min(1, '請輸入帳戶名稱').max(30),
  type: z.enum(ACCOUNT_TYPES),
  currency: currencyEnum.optional(), // defaults to the user's base currency
  statementDay: z.number().int().min(1).max(31).nullable().default(null),
  dueDay: z.number().int().min(1).max(31).nullable().default(null),
  icon: z.string().max(40).default('wallet'),
  color: z.string().max(20).default('#34d399'),
  initialBalance: z.number().finite().default(0),
  includeInTotal: z.boolean().default(true),
});
export type AccountInput = z.infer<typeof accountInput>;

/* ---------- Categories ---------- */
export const categoryInput = z.object({
  name: z.string().trim().min(1, '請輸入類別名稱').max(20),
  type: z.enum(CATEGORY_TYPES),
  icon: z.string().max(40),
  color: z.string().max(20),
  parentId: z.number().int().nullable().default(null),
});
export type CategoryInput = z.infer<typeof categoryInput>;

export const reorderInput = z.object({ ids: z.array(z.number().int()).max(500) });

/* ---------- Tags ---------- */
export const tagInput = z.object({
  name: z.string().trim().min(1).max(20),
  color: z.string().max(20).default('#94a3b8'),
});

/* ---------- Transactions ---------- */
/** occurredAt: local time "YYYY-MM-DDTHH:mm" */
export const transactionInput = z
  .object({
    type: z.enum(TX_TYPES),
    amount: z.number().positive('金額需大於 0').max(999_999_999),
    accountId: z.number().int(),
    toAccountId: z.number().int().nullable().default(null),
    /** transfer between different currencies: amount received by toAccount */
    toAmount: z.number().positive().max(999_999_999).nullable().default(null),
    categoryId: z.number().int().nullable().default(null),
    occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, '日期格式錯誤'),
    note: z.string().max(200).default(''),
    tagIds: z.array(z.number().int()).max(20).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'transfer') {
      if (v.toAccountId == null) ctx.addIssue({ code: 'custom', message: '請選擇轉入帳戶', path: ['toAccountId'] });
      else if (v.toAccountId === v.accountId)
        ctx.addIssue({ code: 'custom', message: '轉出與轉入帳戶不可相同', path: ['toAccountId'] });
    }
  });
export type TransactionInput = z.infer<typeof transactionInput>;

/* ---------- API DTOs ---------- */
export interface User {
  id: number;
  name: string;
  email: string;
  baseCurrency: Currency;
  pinEnabled: boolean;
  lockMinutes: number;
  locked?: boolean;
  /** mobile: biometric quick-unlock enabled */
  biometric?: boolean;
  /** mobile: first-run setup completed */
  onboarded?: boolean;
}
export interface Account {
  id: number;
  name: string;
  type: AccountType;
  icon: string;
  color: string;
  initialBalance: number;
  includeInTotal: boolean;
  sort: number;
  balance: number;
  txCount: number;
  currency: Currency;
  /** balance converted to base currency with the current rate */
  baseBalance: number;
  statementDay: number | null;
  dueDay: number | null;
}
export interface Category {
  id: number;
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  parentId: number | null;
  sort: number;
}
export interface Tag {
  id: number;
  name: string;
  color: string;
}
export interface Transaction {
  id: number;
  type: TxType;
  amount: number;
  accountId: number;
  toAccountId: number | null;
  categoryId: number | null;
  occurredAt: string;
  note: string;
  tagIds: number[];
  baseAmount: number;
  toAmount: number | null;
  installmentId: number | null;
  installmentNo: number | null;
  attachmentIds: number[];
}
export interface Summary {
  income: number;
  expense: number;
  balance: number;
  count: number;
  byCategory: { categoryId: number | null; amount: number; count: number }[];
}

/* =========================== Phase 2 =========================== */

/* ---------- Budgets ---------- */
export const budgetInput = z.object({
  categoryId: z.number().int().nullable().default(null), // null = total monthly budget
  amount: z.number().positive('預算需大於 0').max(999_999_999),
});
export type BudgetInput = z.infer<typeof budgetInput>;
export interface Budget {
  id: number;
  categoryId: number | null;
  amount: number;
  spent: number;
}

/* ---------- Recurring ---------- */
export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Freq = (typeof FREQS)[number];
export const FREQ_LABELS: Record<Freq, string> = { daily: '天', weekly: '週', monthly: '月', yearly: '年' };

export const recurringInput = z
  .object({
    type: z.enum(TX_TYPES),
    amount: z.number().positive('金額需大於 0').max(999_999_999),
    accountId: z.number().int(),
    toAccountId: z.number().int().nullable().default(null),
    categoryId: z.number().int().nullable().default(null),
    note: z.string().max(200).default(''),
    freq: z.enum(FREQS),
    interval: z.number().int().min(1).max(365).default(1),
    startDate: z.string().regex(ymdRe, '開始日期格式錯誤'),
    endDate: z.string().regex(ymdRe).nullable().default(null),
    time: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'transfer' && (v.toAccountId == null || v.toAccountId === v.accountId))
      ctx.addIssue({ code: 'custom', message: '請選擇不同的轉入帳戶', path: ['toAccountId'] });
    if (v.type !== 'transfer' && v.categoryId == null)
      ctx.addIssue({ code: 'custom', message: '請選擇類別', path: ['categoryId'] });
    if (v.endDate && v.endDate < v.startDate)
      ctx.addIssue({ code: 'custom', message: '結束日期不可早於開始日期', path: ['endDate'] });
  });
export type RecurringInput = z.infer<typeof recurringInput>;
export interface RecurringRule {
  id: number;
  type: TxType;
  amount: number;
  accountId: number;
  toAccountId: number | null;
  categoryId: number | null;
  note: string;
  freq: Freq;
  interval: number;
  startDate: string;
  endDate: string | null;
  time: string;
  runCount: number;
  nextDate: string | null;
  active: boolean;
}

/* ---------- Templates ---------- */
export const templateInput = z.object({
  name: z.string().trim().min(1, '請輸入模板名稱').max(20),
  type: z.enum(TX_TYPES),
  amount: z.number().positive().max(999_999_999).nullable().default(null),
  accountId: z.number().int().nullable().default(null),
  toAccountId: z.number().int().nullable().default(null),
  categoryId: z.number().int().nullable().default(null),
  note: z.string().max(200).default(''),
});
export type TemplateInput = z.infer<typeof templateInput>;
export interface Template extends TemplateInput {
  id: number;
  sort: number;
}

/* ---------- Goals ---------- */
export const goalInput = z.object({
  name: z.string().trim().min(1, '請輸入目標名稱').max(30),
  icon: z.string().max(40).default('piggy-bank'),
  color: z.string().max(20).default('#10b981'),
  target: z.number().positive('目標金額需大於 0').max(999_999_999),
  deadline: z.string().regex(ymdRe).nullable().default(null),
});
export type GoalInput = z.infer<typeof goalInput>;
export const goalEntryInput = z.object({
  amount: z
    .number()
    .refine((n) => n !== 0, '金額不可為 0')
    .refine((n) => Math.abs(n) <= 999_999_999, '金額過大'),
  note: z.string().max(100).default(''),
});
export interface Goal extends GoalInput {
  id: number;
  saved: number;
  sort: number;
  createdAt: string;
}
export interface GoalEntry {
  id: number;
  amount: number;
  note: string;
  createdAt: string;
}

/* ---------- Stats ---------- */
export interface TrendPoint {
  key: string; // yyyy-MM-dd or yyyy-MM
  income: number;
  expense: number;
}
export interface CategoryStat {
  categoryId: number | null;
  amount: number;
  count: number;
}

/* =========================== Phase 3 =========================== */

/* ---------- Currency settings ---------- */
export const baseCurrencyInput = z.object({ baseCurrency: currencyEnum });
export const rateInput = z.object({ currency: currencyEnum, rate: z.number().positive('匯率需大於 0').max(1_000_000) });
export interface ExchangeRate {
  currency: Currency;
  rate: number;
  updatedAt: string;
}

/* ---------- Installments ---------- */
export const installmentInput = z.object({
  name: z.string().trim().min(1, '請輸入名稱').max(40),
  total: z.number().positive('金額需大於 0').max(999_999_999),
  periods: z.number().int().min(2, '至少 2 期').max(60),
  accountId: z.number().int(),
  categoryId: z.number().int().nullable().default(null),
  startDate: z.string().regex(ymdRe),
  time: z.string().regex(/^\d{2}:\d{2}$/).default('12:00'),
});
export type InstallmentInput = z.infer<typeof installmentInput>;
export interface InstallmentPlan {
  id: number;
  name: string;
  total: number;
  periods: number;
  accountId: number;
  categoryId: number | null;
  startDate: string;
  posted: number; // periods whose date <= today
  postedAmount: number;
}

/* ---------- Credit card billing ---------- */
export interface CardCycle {
  accountId: number;
  /** last closed statement */
  lastClose: string;
  prevClose: string;
  statementAmount: number;
  paid: number;
  dueDate: string | null;
  /** spending since lastClose (not yet billed) */
  unbilled: number;
  nextClose: string;
  /** future installment periods not yet posted */
  installmentRemaining: number;
}

/* ---------- PIN lock ---------- */
export const pinSetInput = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'PIN 需為 4–6 位數字'),
  password: z.string().min(1, '請輸入登入密碼'),
});
export const pinVerifyInput = z.object({ pin: z.string().regex(/^\d{4,6}$/) });
export const lockSettingsInput = z.object({ lockMinutes: z.number().int().refine((n) => [1, 5, 15, 30, 60].includes(n)) });
export const pinDisableInput = z.object({ password: z.string().min(1, '請輸入登入密碼') });

/* ---------- Import ---------- */
export interface ImportRow {
  line: number;
  occurredAt: string;
  type: TxType;
  amount: number;
  account: string;
  toAccount: string | null;
  category: string | null;
  subcategory: string | null;
  note: string;
  tags: string[];
  error?: string;
}
export interface ImportPreview {
  rows: ImportRow[];
  newAccounts: string[];
  newCategories: string[];
  newTags: string[];
}
