import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Reorder, motion, useDragControls } from 'framer-motion';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { ChevronRight, GripVertical, Layers, Plus, Trash2 } from 'lucide-react';
import {
  ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, accountInput, type Account, type AccountType, type Currency,
} from '@ledger/shared';
import { useAccounts, useCardCycle, useDeleteAccount, useInstallments, useMe, useRates, useReorder, useSaveAccount } from '@/lib/queries';
import { cn, fmt, money } from '@/lib/format';
import { IconTile } from '@/lib/icons';
import { useUI } from '@/stores/ui';
import { AnimatedMoney, Button, Confirm, Field, Input, PageHeader, Sheet } from '@/components/ui';
import { ColorPicker, IconPicker } from '@/components/Pickers';
import { CurrencySelect } from './Currency';

const TYPE_ICON: Record<AccountType, string> = { cash: 'wallet', bank: 'landmark', credit: 'credit-card', ewallet: 'smartphone', other: 'coins' };

export function AccountsPage() {
  const { data: accounts = [] } = useAccounts();
  const { data: plans = [] } = useInstallments();
  const reorder = useReorder('accounts');
  const [order, setOrder] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  useEffect(() => setOrder(accounts), [accounts]);

  const inc = accounts.filter((a) => a.includeInTotal);
  const assets = inc.filter((a) => a.baseBalance > 0).reduce((s, a) => s + a.baseBalance, 0);
  const debts = inc.filter((a) => a.baseBalance < 0).reduce((s, a) => s + a.baseBalance, 0);
  const activePlans = plans.filter((p) => p.posted < p.periods).length;

  return (
    <div>
      <PageHeader
        title="帳戶"
        right={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> 新增
          </Button>
        }
      />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-5">
        <p className="text-sm text-muted">淨資產</p>
        <AnimatedMoney value={assets + debts} className="block text-3xl font-extrabold" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-income/10 p-3">
            <p className="text-xs text-muted">資產</p>
            <AnimatedMoney value={assets} className="font-bold text-income" />
          </div>
          <div className="rounded-2xl bg-expense/10 p-3">
            <p className="text-xs text-muted">負債</p>
            <AnimatedMoney value={Math.abs(debts)} className="font-bold text-expense" />
          </div>
        </div>
      </motion.div>

      <Link to="/installments" className="card mt-3 flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2/50">
        <span className="grid size-9 place-items-center rounded-xl bg-primary-soft text-primary"><Layers className="size-4.5" /></span>
        <span className="flex-1 font-medium">分期付款</span>
        <span className="text-sm text-muted">{activePlans ? `${activePlans} 筆進行中` : '查看'}</span>
        <ChevronRight className="size-4 text-muted" />
      </Link>

      <p className="mb-2 mt-6 px-1 text-xs text-muted">拖曳左側把手可調整排序</p>
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="card divide-y divide-border overflow-hidden">
        {order.map((a) => (
          <AccountRow key={a.id} a={a} onEdit={() => setEditing(a)} onDrop={() => reorder.mutate(order.map((o) => o.id))} />
        ))}
      </Reorder.Group>

      <AccountSheet editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function AccountRow({ a, onEdit, onDrop }: { a: Account; onEdit: () => void; onDrop: () => void }) {
  const controls = useDragControls();
  const { data: me } = useMe();
  const foreign = me && a.currency !== me.baseCurrency;
  return (
    <Reorder.Item value={a} dragListener={false} dragControls={controls} onDragEnd={onDrop} className="relative bg-surface" whileDrag={{ scale: 1.02, boxShadow: '0 12px 30px -10px rgb(0 0 0 / 0.25)', zIndex: 10 }}>
      <div className="flex items-center gap-3 px-3 py-3.5">
        <button className="cursor-grab touch-none p-1 text-muted active:cursor-grabbing" onPointerDown={(e) => controls.start(e)} aria-label="拖曳排序">
          <GripVertical className="size-4" />
        </button>
        <button onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <IconTile name={a.icon} color={a.color} size={44} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate font-semibold">
              {a.name}
              {foreign && <span className="rounded-md bg-surface-2 px-1.5 text-[11px] font-medium text-muted">{a.currency}</span>}
            </p>
            <p className="text-[13px] text-muted">
              {ACCOUNT_TYPE_LABELS[a.type]} · {a.txCount} 筆{!a.includeInTotal && ' · 不計入總額'}
            </p>
          </div>
          <span className="text-right">
            <span className={cn('num block text-[17px] font-bold', a.balance < 0 && 'text-expense')}>{money(a.balance, { currency: a.currency })}</span>
            {foreign && <span className="num block text-[11px] text-muted">≈ {money(a.baseBalance)}</span>}
          </span>
        </button>
      </div>
      {a.type === 'credit' && <CardCycleStrip a={a} />}
    </Reorder.Item>
  );
}

/** Credit card: last statement, payment status, due date, unbilled and future installments */
function CardCycleStrip({ a }: { a: Account }) {
  const { data: c } = useCardCycle(a.id);
  if (!c) return null;
  const owe = Math.max(0, c.statementAmount - c.paid);
  const days = c.dueDate ? differenceInCalendarDays(parseISO(c.dueDate), new Date()) : null;
  const status =
    c.statementAmount <= 0 ? { t: '本期無帳單', cls: 'text-muted' }
    : owe <= 0 ? { t: '已繳清', cls: 'text-primary' }
    : days != null && days < 0 ? { t: `逾期 ${-days} 天`, cls: 'text-expense font-semibold' }
    : days != null ? { t: `${days === 0 ? '今天' : `${days} 天後`}到期`, cls: days <= 3 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-muted' }
    : { t: '待繳', cls: 'text-muted' };
  return (
    <div className="mx-3 mb-3 grid grid-cols-3 gap-2 rounded-2xl bg-surface-2/60 p-3 text-center">
      <div>
        <p className="text-[11px] text-muted">本期應繳（{fmt(parseISO(c.lastClose), 'M/d')} 結）</p>
        <p className="num text-sm font-bold">{money(owe, { currency: a.currency })}</p>
        <p className={cn('text-[11px]', status.cls)}>{status.t}</p>
      </div>
      <div>
        <p className="text-[11px] text-muted">未出帳</p>
        <p className="num text-sm font-bold">{money(c.unbilled, { currency: a.currency })}</p>
        <p className="text-[11px] text-muted">{fmt(parseISO(c.nextClose), 'M/d')} 結帳</p>
      </div>
      <div>
        <p className="text-[11px] text-muted">未到期分期</p>
        <p className="num text-sm font-bold">{money(c.installmentRemaining, { currency: a.currency })}</p>
        <p className="text-[11px] text-muted">{c.dueDate ? `繳款日 ${fmt(parseISO(c.dueDate), 'M/d')}` : '未設繳款日'}</p>
      </div>
    </div>
  );
}

function AccountSheet({ editing, onClose }: { editing: Account | 'new' | null; onClose: () => void }) {
  const save = useSaveAccount();
  const del = useDeleteAccount();
  const { data: me } = useMe();
  const { data: rates = [] } = useRates();
  const toast = useUI((s) => s.toast);
  const [confirm, setConfirm] = useState(false);
  const base = (me?.baseCurrency ?? 'TWD') as Currency;
  const blank = {
    name: '', type: 'cash' as AccountType, icon: 'wallet', color: '#10b981', initialBalance: '0', includeInTotal: true,
    currency: base, statementDay: '', dueDay: '',
  };
  const [f, setF] = useState(blank);
  const acc = editing && editing !== 'new' ? editing : null;
  const lockedCurrency = !!acc && acc.txCount > 0;
  const available = [base, ...rates.map((r) => r.currency)];

  useEffect(() => {
    if (!editing) return;
    setF(
      acc
        ? {
            name: acc.name, type: acc.type, icon: acc.icon, color: acc.color, initialBalance: String(acc.initialBalance), includeInTotal: acc.includeInTotal,
            currency: acc.currency, statementDay: acc.statementDay ? String(acc.statementDay) : '', dueDay: acc.dueDay ? String(acc.dueDay) : '',
          }
        : blank,
    );
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = accountInput.safeParse({
      ...f,
      initialBalance: Number(f.initialBalance) || 0,
      statementDay: f.type === 'credit' && f.statementDay ? Number(f.statementDay) : null,
      dueDay: f.type === 'credit' && f.dueDay ? Number(f.dueDay) : null,
    });
    if (!parsed.success) return toast({ message: parsed.error.issues[0].message, tone: 'error' });
    try {
      await save.mutateAsync({ id: acc?.id, data: parsed.data });
      toast({ message: acc ? '帳戶已更新' : '帳戶已建立' });
      onClose();
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  const remove = async () => {
    try {
      await del.mutateAsync(acc!.id);
      toast({ message: '帳戶已刪除' });
      setConfirm(false);
      onClose();
    } catch (err) {
      setConfirm(false);
      toast({ message: (err as Error).message, tone: 'error', duration: 5000 });
    }
  };

  const dayOpts = Array.from({ length: 31 }, (_, i) => String(i + 1));
  const selectCls = 'h-12 w-full rounded-2xl border border-border bg-surface-2/60 px-4 text-[15px] text-fg outline-none focus:border-primary';

  return (
    <>
      <Sheet open={!!editing} onClose={onClose} title={acc ? '編輯帳戶' : '新增帳戶'}>
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center gap-4">
            <motion.div key={f.icon + f.color} initial={{ scale: 0.8, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
              <IconTile name={f.icon} color={f.color} size={60} />
            </motion.div>
            <div className="flex-1">
              <Field label="名稱">
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="例如：玉山銀行" maxLength={30} />
              </Field>
            </div>
          </div>
          <Field label="類型">
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_TYPES.map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setF({ ...f, type: t, icon: f.icon === TYPE_ICON[f.type] ? TYPE_ICON[t] : f.icon })}
                  className={cn('h-9 rounded-full border px-3.5 text-sm font-medium transition-colors', f.type === t ? 'border-primary bg-primary-soft' : 'border-border text-muted')}
                >
                  {ACCOUNT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </Field>
          <Field label={lockedCurrency ? '幣別（已有紀錄，無法變更）' : '幣別'}>
            <CurrencySelect
              value={f.currency}
              onChange={(currency) => setF({ ...f, currency })}
              disabled={lockedCurrency}
              only={available}
            />
            {!available.includes(f.currency) && <span className="block text-xs text-expense">尚未設定 {f.currency} 匯率，請先到「更多 → 幣別與匯率」新增</span>}
          </Field>
          {f.type === 'credit' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="grid grid-cols-2 gap-3">
              <Field label="結帳日">
                <select value={f.statementDay} onChange={(e) => setF({ ...f, statementDay: e.target.value })} className={selectCls}>
                  <option value="">未設定</option>
                  {dayOpts.map((d) => <option key={d} value={d}>每月 {d} 日</option>)}
                </select>
              </Field>
              <Field label="繳款截止日">
                <select value={f.dueDay} onChange={(e) => setF({ ...f, dueDay: e.target.value })} className={selectCls}>
                  <option value="">未設定</option>
                  {dayOpts.map((d) => <option key={d} value={d}>每月 {d} 日</option>)}
                </select>
              </Field>
            </motion.div>
          )}
          <Field label={f.type === 'credit' ? '初始餘額（欠款請輸入負數）' : '初始餘額'}>
            <Input type="number" inputMode="decimal" step="0.01" value={f.initialBalance} onChange={(e) => setF({ ...f, initialBalance: e.target.value })} />
          </Field>
          <label className="flex items-center justify-between rounded-2xl bg-surface-2/60 px-4 py-3">
            <span className="text-sm font-medium">計入淨資產</span>
            <Toggle on={f.includeInTotal} onChange={(v) => setF({ ...f, includeInTotal: v })} />
          </label>
          <Field label="顏色">
            <ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} />
          </Field>
          <Field label="圖示">
            <IconPicker value={f.icon} color={f.color} onChange={(icon) => setF({ ...f, icon })} />
          </Field>
          <div className="flex gap-3">
            {acc && (
              <Button type="button" variant="danger" size="icon" className="size-12 shrink-0" onClick={() => setConfirm(true)} aria-label="刪除帳戶">
                <Trash2 className="size-5" />
              </Button>
            )}
            <Button type="submit" size="lg" className="h-12 flex-1" loading={save.isPending}>
              儲存
            </Button>
          </div>
        </form>
      </Sheet>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="刪除帳戶？"
        message={`確定要刪除「${acc?.name}」嗎？有紀錄的帳戶需先刪除相關紀錄。`}
        confirmText="刪除"
        onConfirm={remove}
        loading={del.isPending}
      />
    </>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-primary' : 'bg-border')}
    >
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} className={cn('absolute top-1 size-5 rounded-full bg-white shadow', on ? 'right-1' : 'left-1')} />
    </button>
  );
}
