import { sqliteTable, integer, text, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const createdAt = () => text('created_at').notNull().default(sql`(datetime('now'))`);

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  baseCurrency: text('base_currency').notNull().default('TWD'),
  pinHash: text('pin_hash'),
  lockMinutes: integer('lock_minutes').notNull().default(5),
  createdAt: createdAt(),
});

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    icon: text('icon').notNull(),
    color: text('color').notNull(),
    /** stored in cents */
    initialBalance: integer('initial_balance').notNull().default(0),
    includeInTotal: integer('include_in_total', { mode: 'boolean' }).notNull().default(true),
    currency: text('currency').notNull().default('TWD'),
    statementDay: integer('statement_day'),
    dueDay: integer('due_day'),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    parentId: integer('parent_id'),
    type: text('type').notNull(),
    name: text('name').notNull(),
    icon: text('icon').notNull(),
    color: text('color').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('categories_user_idx').on(t.userId)],
);

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
  },
  (t) => [uniqueIndex('tags_user_name_idx').on(t.userId, t.name)],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    /** stored in cents */
    amount: integer('amount').notNull(),
    accountId: integer('account_id').notNull(),
    toAccountId: integer('to_account_id'),
    categoryId: integer('category_id'),
    occurredAt: text('occurred_at').notNull(),
    note: text('note').notNull().default(''),
    deletedAt: text('deleted_at'),
    recurringId: integer('recurring_id'),
    /** amount converted to the user's base currency at write time (cents) */
    baseAmount: integer('base_amount'),
    /** transfer: amount received by to_account in its currency (cents) */
    toAmount: integer('to_amount'),
    installmentId: integer('installment_id'),
    installmentNo: integer('installment_no'),
    createdAt: createdAt(),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [index('tx_user_date_idx').on(t.userId, t.occurredAt)],
);

export const transactionTags = sqliteTable(
  'transaction_tags',
  {
    transactionId: integer('transaction_id').notNull(),
    tagId: integer('tag_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.tagId] })],
);

/* ---------- Phase 2 ---------- */
export const budgets = sqliteTable('budgets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  categoryId: integer('category_id'),
  amount: integer('amount').notNull(),
});

export const recurringRules = sqliteTable('recurring_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  type: text('type').notNull(),
  amount: integer('amount').notNull(),
  accountId: integer('account_id').notNull(),
  toAccountId: integer('to_account_id'),
  categoryId: integer('category_id'),
  note: text('note').notNull().default(''),
  freq: text('freq').notNull(),
  interval: integer('interval').notNull().default(1),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  time: text('time').notNull().default('09:00'),
  runCount: integer('run_count').notNull().default(0),
  nextDate: text('next_date'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const templates = sqliteTable('templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  amount: integer('amount'),
  accountId: integer('account_id'),
  toAccountId: integer('to_account_id'),
  categoryId: integer('category_id'),
  note: text('note').notNull().default(''),
  sort: integer('sort').notNull().default(0),
});

export const goals = sqliteTable('goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  name: text('name').notNull(),
  icon: text('icon').notNull(),
  color: text('color').notNull(),
  target: integer('target').notNull(),
  deadline: text('deadline'),
  sort: integer('sort').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const goalEntries = sqliteTable('goal_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  goalId: integer('goal_id').notNull(),
  userId: integer('user_id').notNull(),
  amount: integer('amount').notNull(),
  note: text('note').notNull().default(''),
  createdAt: text('created_at').notNull().default(sql`(datetime('now','localtime'))`),
});

/* ---------- Phase 3 ---------- */
export const exchangeRates = sqliteTable('exchange_rates', {
  userId: integer('user_id').notNull(),
  currency: text('currency').notNull(),
  rate: real('rate').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [primaryKey({ columns: [t.userId, t.currency] })]);

export const installmentPlans = sqliteTable('installment_plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  accountId: integer('account_id').notNull(),
  categoryId: integer('category_id'),
  name: text('name').notNull(),
  total: integer('total').notNull(),
  periods: integer('periods').notNull(),
  startDate: text('start_date').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const attachments = sqliteTable('attachments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  transactionId: integer('transaction_id').notNull(),
  file: text('file').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
