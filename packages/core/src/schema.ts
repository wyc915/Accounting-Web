import type { Sql } from './db.js';

/**
 * Versioned migrations (PRAGMA user_version). Single-user, on-device schema.
 * Never edit a shipped migration — append a new one.
 */
const MIGRATIONS: string[] = [
  /* v1 — initial schema (ported from the web server, without users/user_id) */
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'TWD',
    initial_balance INTEGER NOT NULL DEFAULT 0,
    include_in_total INTEGER NOT NULL DEFAULT 1,
    statement_day INTEGER,
    due_day INTEGER,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
  );
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
  );
  CREATE TABLE recurring_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    to_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT '',
    freq TEXT NOT NULL,
    interval INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    end_date TEXT,
    time TEXT NOT NULL DEFAULT '09:00',
    run_count INTEGER NOT NULL DEFAULT 0,
    next_date TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE installment_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    total INTEGER NOT NULL,
    periods INTEGER NOT NULL,
    start_date TEXT NOT NULL
  );
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('expense','income','transfer')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    base_amount INTEGER NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    to_account_id INTEGER REFERENCES accounts(id),
    to_amount INTEGER,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    occurred_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    recurring_id INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL,
    installment_id INTEGER REFERENCES installment_plans(id) ON DELETE CASCADE,
    installment_no INTEGER,
    deleted_at TEXT,
    created_at TEXT,
    updated_at TEXT
  );
  CREATE INDEX tx_date_idx ON transactions(occurred_at);
  CREATE INDEX tx_account_idx ON transactions(account_id);
  CREATE TABLE transaction_tags (
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (transaction_id, tag_id)
  );
  CREATE TABLE attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT
  );
  CREATE INDEX attachments_tx_idx ON attachments(transaction_id);
  CREATE TABLE budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0)
  );
  CREATE UNIQUE INDEX budgets_cat_idx ON budgets(COALESCE(category_id, 0));
  CREATE TABLE templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    amount INTEGER,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    to_account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    target INTEGER NOT NULL CHECK (target > 0),
    deadline TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT
  );
  CREATE TABLE goal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT
  );
  CREATE TABLE exchange_rates (
    currency TEXT PRIMARY KEY,
    rate REAL NOT NULL CHECK (rate > 0),
    updated_at TEXT
  );
  `,
];

export async function migrate(sql: Sql) {
  await sql.db.exec('PRAGMA foreign_keys = ON;');
  const row = await sql.get<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await sql.tx(async () => {
      await sql.db.exec(MIGRATIONS[v]);
    });
    await sql.db.exec(`PRAGMA user_version = ${v + 1};`);
  }
  return MIGRATIONS.length;
}
