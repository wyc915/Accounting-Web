import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { format, getDaysInMonth, isSameMonth, startOfMonth } from 'date-fns';
import { AlertTriangle, CheckCircle2, Plus, Target, Trash2 } from 'lucide-react';
import type { Budget } from '@ledger/shared';
import { useBudgets, useDeleteBudget, useLookups, useSaveBudget } from '@/lib/queries';
import { cn, money } from '@/lib/format';
import { IconTile } from '@/lib/icons';
import { useUI } from '@/stores/ui';
import { AnimatedMoney, Button, Confirm, Empty, Field, Input, PageHeader, Sheet } from '@/components/ui';
import { PeriodNav } from '@/components/PeriodNav';

/** status: reserved colors, always paired with icon + label */
export function budgetStatus(b: Pick<Budget, 'amount' | 'spent'>) {
  const r = b.spent / b.amount;
  if (r > 1) return { tone: 'over', label: '已超支', color: '#dc2626', Icon: AlertTriangle } as const;
  if (r >= 0.8) return { tone: 'warn', label: '接近上限', color: '#d97706', Icon: AlertTriangle } as const;
  return { tone: 'ok', label: '正常', color: 'var(--primary)', Icon: CheckCircle2 } as const;
}

export function BudgetsPage() {
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const key = format(month, 'yyyy-MM');
  const { data: budgets = [], isLoading } = useBudgets(key);
  const { catMap } = useLookups();
  const [editing, setEditing] = useState<Partial<Budget> | null>(null);

  const total = budgets.find((b) => b.categoryId == null);
  const catBudgets = budgets.filter((b) => b.categoryId != null);

  // daily allowance for current month
  const current = isSameMonth(month, new Date());
  const daysLeft = current ? getDaysInMonth(month) - new Date().getDate() + 1 : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="預算"
        right={
          <Button size="sm" onClick={() => setEditing({})}>
            <Plus className="size-4" /> 新增
          </Button>
        }
      />
      <div className="card p-4">
        <PeriodNav mode="month" anchor={month} onChange={(d) => setMonth(startOfMonth(d))} />
      </div>

      {total ? <TotalCard b={total} daysLeft={daysLeft} onEdit={() => setEditing(total)} /> : (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setEditing({ categoryId: null })}
          className="card flex w-full items-center gap-4 border-dashed p-5 text-left hover:bg-surface-2/50"
        >
          <span className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary"><Target className="size-6" /></span>
          <div>
            <p className="font-semibold">設定每月總預算</p>
            <p className="text-sm text-muted">掌握整體花費，超支時提醒你</p>
          </div>
        </motion.button>
      )}

      <section>
        <h2 className="mb-3 px-1 text-lg font-bold">類別預算</h2>
        {!isLoading && catBudgets.length === 0 ? (
          <div className="card">
            <Empty icon={<Target className="size-7" />} title="還沒有類別預算" hint="例如：餐飲每月 $6,000" action={<Button onClick={() => setEditing({})}><Plus className="size-4" /> 新增類別預算</Button>} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {catBudgets.map((b, i) => {
              const c = catMap.get(b.categoryId!);
              const st = budgetStatus(b);
              const pct = Math.min(100, (b.spent / b.amount) * 100);
              return (
                <motion.button
                  key={b.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setEditing(b)}
                  className="card p-4 text-left"
                >
                  <div className="flex items-center gap-3">
                    <IconTile name={c?.icon ?? 'ellipsis'} color={c?.color ?? '#94a3b8'} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{c?.name ?? '已刪除類別'}</p>
                      <p className="flex items-center gap-1 text-xs font-medium" style={{ color: st.color }}>
                        <st.Icon className="size-3.5" /> {st.label}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="num font-bold">{money(b.spent)}</p>
                      <p className="num text-xs text-muted">/ {money(b.amount)}</p>
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: st.tone === 'ok' ? c?.color ?? 'var(--primary)' : st.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.9, delay: 0.1 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {b.spent > b.amount ? `超出 ${money(b.spent - b.amount)}` : `剩餘 ${money(b.amount - b.spent)}`}
                  </p>
                </motion.button>
              );
            })}
          </div>
        )}
      </section>

      <BudgetSheet editing={editing} existing={budgets} onClose={() => setEditing(null)} />
    </div>
  );
}

function TotalCard({ b, daysLeft, onEdit }: { b: Budget; daysLeft: number; onEdit: () => void }) {
  const st = budgetStatus(b);
  const ratio = b.spent / b.amount;
  const R = 54;
  const C = 2 * Math.PI * R;
  const remain = b.amount - b.spent;
  return (
    <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} onClick={onEdit} className="card flex w-full items-center gap-5 p-5 text-left">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 128 128" className="size-full -rotate-90">
          <circle cx="64" cy="64" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
          <motion.circle
            cx="64" cy="64" r={R} fill="none" stroke={st.tone === 'ok' ? 'var(--primary)' : st.color} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - Math.min(1, ratio)) }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="num text-2xl font-extrabold">{Math.round(ratio * 100)}%</p>
            <p className="text-[11px] text-muted">已使用</p>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex items-center gap-1 text-sm font-medium" style={{ color: st.color }}>
          <st.Icon className="size-4" /> 總預算 · {st.label}
        </p>
        <p className="text-sm text-muted">{remain >= 0 ? '剩餘' : '超支'}</p>
        <AnimatedMoney value={Math.abs(remain)} className="block text-2xl font-extrabold" />
        <p className="num text-xs text-muted">已花 {money(b.spent)} / {money(b.amount)}</p>
        {daysLeft > 0 && remain > 0 && <p className="text-xs text-muted">每日可用 <b className="num text-fg">{money(Math.floor((remain / daysLeft) * 100) / 100)}</b>（剩 {daysLeft} 天）</p>}
      </div>
    </motion.button>
  );
}

function BudgetSheet({ editing, existing, onClose }: { editing: Partial<Budget> | null; existing: Budget[]; onClose: () => void }) {
  const { cats } = useLookups();
  const save = useSaveBudget();
  const del = useDeleteBudget();
  const toast = useUI((s) => s.toast);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [confirm, setConfirm] = useState(false);
  const isEdit = editing?.id != null;

  useEffect(() => {
    if (!editing) return;
    setCategoryId(editing.categoryId === undefined ? (cats.find((c) => c.type === 'expense' && c.parentId == null && !existing.some((b) => b.categoryId === c.id))?.id ?? null) : editing.categoryId);
    setAmount(editing.amount ? String(editing.amount) : '');
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const parents = cats.filter((c) => c.type === 'expense' && c.parentId == null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0)) return toast({ message: '請輸入預算金額', tone: 'error' });
    try {
      await save.mutateAsync({ categoryId, amount: n });
      toast({ message: '預算已儲存' });
      onClose();
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <>
      <Sheet open={!!editing} onClose={onClose} title={isEdit ? '編輯預算' : '新增預算'}>
        <form onSubmit={submit} className="space-y-5">
          {!isEdit && (
            <Field label="預算對象">
              <div className="flex flex-wrap gap-2">
                <Chip on={categoryId == null} onClick={() => setCategoryId(null)}>
                  <span className="grid size-[22px] place-items-center rounded-full bg-primary-soft text-primary"><Target className="size-3.5" /></span>
                  每月總預算
                </Chip>
                {parents.map((c) => (
                  <Chip key={c.id} on={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                    <IconTile name={c.icon} color={c.color} size={22} className="rounded-full" />
                    {c.name}
                    {existing.some((b) => b.categoryId === c.id) && <span className="text-[10px] text-muted">已設</span>}
                  </Chip>
                ))}
              </div>
            </Field>
          )}
          <Field label="每月預算金額">
            <Input type="number" inputMode="decimal" min={0} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="例如 6000" autoFocus />
          </Field>
          <p className="text-xs text-muted">預算每月自動套用；類別預算包含其所有子類別的支出。</p>
          <div className="flex gap-3">
            {isEdit && (
              <Button type="button" variant="danger" size="icon" className="size-12 shrink-0" onClick={() => setConfirm(true)} aria-label="刪除預算">
                <Trash2 className="size-5" />
              </Button>
            )}
            <Button type="submit" className="h-12 flex-1" loading={save.isPending}>儲存</Button>
          </div>
        </form>
      </Sheet>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="刪除預算？"
        confirmText="刪除"
        loading={del.isPending}
        onConfirm={async () => {
          await del.mutateAsync(editing!.id!);
          setConfirm(false);
          onClose();
          toast({ message: '預算已刪除' });
        }}
      />
    </>
  );
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-full border pl-1.5 pr-3 text-sm font-medium transition-colors',
        on ? 'border-primary bg-primary-soft text-fg' : 'border-border text-muted hover:text-fg',
      )}
    >
      {children}
    </motion.button>
  );
}

