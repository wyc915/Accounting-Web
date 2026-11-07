/* Runs the on-device business logic against better-sqlite3 in Node. Usage: npm test -w packages/core */
import Database from 'better-sqlite3';
import { format, addDays } from 'date-fns';
import { createCore, isEncrypted, type Db } from '../src/index.js';

function nodeDb(): Db {
  const d = new Database(':memory:');
  return {
    async run(sql, params = []) {
      const r = d.prepare(sql).run(...params);
      return { changes: r.changes, lastId: Number(r.lastInsertRowid) };
    },
    async all(sql, params = []) {
      const st = d.prepare(sql);
      return (st.reader ? st.all(...params) : (st.run(...params), [])) as never;
    },
    async exec(sql) {
      d.exec(sql);
    },
    async begin() {
      d.exec('BEGIN');
    },
    async commit() {
      d.exec('COMMIT');
    },
    async rollback() {
      d.exec('ROLLBACK');
    },
  };
}

let pass = 0;
let fail = 0;
const ok = (c: unknown, msg: string) => {
  if (c) pass++;
  else fail++;
  console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`);
};
const throws = async (fn: () => Promise<unknown>, re: RegExp, msg: string) => {
  try {
    await fn();
    ok(false, `${msg} (did not throw)`);
  } catch (e) {
    ok(re.test((e as Error).message), `${msg}: ${(e as Error).message}`);
  }
};

const core = createCore(nodeDb());
ok((await core.init()) === 1, 'migrations applied');
let me = await core.app.me();
ok(!me.onboarded, 'fresh install is not onboarded');
me = await core.app.onboard({ name: '測試', baseCurrency: 'TWD' });
ok(me.onboarded && me.name === '測試', 'onboarding stores profile');
const accs = await core.accounts.list();
const cats = await core.categories.list();
ok(accs.length === 3 && cats.length === 32, `seeded ${accs.length} accounts / ${cats.length} categories`);
const cash = accs.find((a) => a.type === 'cash')!.id;
const bank = accs.find((a) => a.type === 'bank')!.id;
const card = accs.find((a) => a.type === 'credit')!.id;
const lunch = cats.find((c) => c.name === '午餐')!.id;
const today = format(new Date(), 'yyyy-MM-dd');
const now = format(new Date(), "yyyy-MM-dd'T'HH:mm");

// transactions
const t1 = await core.transactions.create({ type: 'expense', amount: 120, accountId: cash, categoryId: lunch, occurredAt: now, note: '便當' });
ok(t1.amount === 120 && t1.baseAmount === 120, 'create expense');
await core.transactions.create({ type: 'transfer', amount: 1000, accountId: bank, toAccountId: cash, occurredAt: now });
let list = await core.accounts.list();
ok(list.find((a) => a.id === cash)!.balance === 880, `cash balance ${list.find((a) => a.id === cash)!.balance}`);
const sum = await core.transactions.summary({ from: today, to: format(addDays(new Date(), 1), 'yyyy-MM-dd') });
ok(sum.expense === 120 && sum.byCategory[0].amount === 120, 'summary rolls up to parent category');
ok((await core.transactions.list({ q: '便當' })).length === 1, 'search by note');
await core.transactions.remove(t1.id);
ok((await core.transactions.list({ q: '便當' })).length === 0, 'soft delete hides');
await core.transactions.restore(t1.id);
ok((await core.transactions.list({ q: '便當' })).length === 1, 'restore brings it back');

// currency
await throws(() => core.accounts.create({ name: '日幣', type: 'cash', currency: 'JPY', initialBalance: 10000 }), /JPY/, 'foreign account needs rate');
await core.app.upsertRate({ currency: 'JPY', rate: 0.21 });
const jpy = await core.accounts.create({ name: '日幣', type: 'cash', currency: 'JPY', initialBalance: 10000 });
ok(jpy.baseBalance === 2100, 'JPY base balance');
const ramen = await core.transactions.create({ type: 'expense', amount: 1500, accountId: jpy.id, categoryId: lunch, occurredAt: now });
ok(ramen.baseAmount === 315, `JPY expense base ${ramen.baseAmount}`);
const xfer = await core.transactions.create({ type: 'transfer', amount: 2100, accountId: bank, toAccountId: jpy.id, occurredAt: now });
ok(xfer.toAmount === 10000, 'cross-currency transfer');

// recurring
const rent = cats.find((c) => c.name === '房租')!.id;
const r = await core.recurring.create({ type: 'expense', amount: 15000, accountId: bank, categoryId: rent, note: 'rent', freq: 'monthly', startDate: '2026-08-31' });
ok(r.created >= 3, `recurring backfilled ${r.created}`);
const r2 = await core.recurring.update(r.rule.id, { type: 'expense', amount: 16000, accountId: bank, categoryId: rent, note: 'rent', freq: 'monthly', startDate: '2026-08-31' });
ok(r2.created === 0, 'editing rule does not duplicate');

// budgets + stats
await core.stats.upsertBudget({ categoryId: null, amount: 30000 });
await core.stats.upsertBudget({ categoryId: cats.find((c) => c.name === '餐飲')!.id, amount: 300 });
const budgets = await core.stats.budgets();
ok(budgets.length === 2 && budgets.some((b) => b.categoryId != null && b.spent === 435), `budget spent ${JSON.stringify(budgets.map((b) => b.spent))}`);
ok((await core.stats.trend({ from: '2026-01-01', to: '2027-12-31', unit: 'month' })).length >= 1, 'trend');

// installments
const plan = await core.installments.create({ name: '手機', total: 30001, periods: 3, accountId: card, startDate: today, time: '00:00' });
ok(plan.posted === 1, 'installment posts first period only');
const parts = (await core.transactions.list({ q: '手機' })).map((t) => t.amount).sort();
ok(parts.join() === '10000,10000,10001', `installment split ${parts}`);
ok((await core.accounts.cycle(card)).installmentRemaining === 20000, 'card cycle future installments');

// attachments
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const att = await core.transactions.addAttachment(t1.id, png);
ok(att.mime === 'image/png', 'attach receipt');
await throws(() => core.transactions.addAttachment(t1.id, btoa('<script>alert(1)</script>')), /只接受/, 'rejects non-image');

// templates, goals
await core.templates.create({ name: '早餐', type: 'expense', amount: 60, accountId: cash, categoryId: cats.find((c) => c.name === '早餐')!.id });
const g = await core.goals.create({ name: '旅行', target: 60000, icon: 'plane', color: '#0ea5e9' });
ok((await core.goals.addEntry(g.id, { amount: 5000 })).saved === 5000, 'goal deposit');
await throws(() => core.goals.addEntry(g.id, { amount: -99999 }), /提領/, 'goal over-withdraw blocked');

// PIN
await core.app.setPin({ pin: '1234' });
await throws(() => core.app.verifyPin({ pin: '0000' }), /PIN 錯誤/, 'wrong PIN');
ok((await core.app.verifyPin({ pin: '1234' })).ok, 'correct PIN');
await throws(() => core.app.setPin({ current: '9999', pin: '5678' }), /目前的 PIN/, 'change PIN needs current');

// export / import
const csv = await core.data.exportCsv();
ok(csv.startsWith('﻿日期') && csv.includes('便當'), 'CSV export');
const xlsx = await core.data.exportXlsx();
ok(xlsx[0] === 0x50 && xlsx[1] === 0x4b, `XLSX export ${xlsx.length} bytes`);
const pv = await core.data.importPreview({ name: 'a.csv', text: '日期,類型,金額,帳戶,類別,子類別,備註\n2026/11/3,支出,"1,250",悠遊卡,交通,高鐵,出差\nbad,支出,1,現金,,,x\n' });
ok(pv.rows.length === 2 && pv.rows[1].error && pv.newAccounts.includes('悠遊卡'), 'import preview');
ok((await core.data.importCommit({ rows: pv.rows })).created === 1, 'import commit');
ok((await core.data.importCommit({ rows: pv.rows })).skipped === 1, 're-import skips duplicates');

// backup round-trip (encrypted) into a fresh device
const enc = await core.data.backup({ password: 'pw-123' });
ok(isEncrypted(enc), 'backup encrypted');
const other = createCore(nodeDb());
await other.init();
await throws(() => other.data.restore(enc), /加密/, 'restore needs password');
await throws(() => other.data.restore(enc, 'wrong'), /密碼不正確/, 'wrong backup password');
const counts = await other.data.restore(enc, 'pw-123');
const a1 = (await core.accounts.list()).map((a) => `${a.name}:${a.balance}`).sort().join('|');
const a2 = (await other.accounts.list()).map((a) => `${a.name}:${a.balance}`).sort().join('|');
ok(a1 === a2, `restored balances match (${counts.transactions} tx, ${counts.attachments} photos)`);
ok((await other.app.me()).onboarded, 'restored device is onboarded');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
