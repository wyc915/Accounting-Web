import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { differenceInCalendarDays, differenceInCalendarMonths, parseISO } from 'date-fns';
import { Goal as GoalIcon, Minus, PartyPopper, Pencil, Plus, Trash2, X } from 'lucide-react';
import { goalInput, type Goal } from '@ledger/shared';
import { useDeleteGoal, useDeleteGoalEntry, useGoalEntries, useGoalEntry, useGoals, useSaveGoal } from '@/lib/queries';
import { cn, fmt, money, ymd } from '@/lib/format';
import { Icon, IconTile } from '@/lib/icons';
import { useUI } from '@/stores/ui';
import { AnimatedMoney, Button, Confirm, Empty, Field, Input, PageHeader, Segmented, Sheet } from '@/components/ui';
import { ColorPicker, IconPicker } from '@/components/Pickers';
import { Calendar } from '@/components/DatePicker';

export function GoalRing({ goal, size = 88, stroke = 9 }: { goal: Pick<Goal, 'saved' | 'target' | 'color' | 'icon'>; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const p = Math.min(1, goal.saved / goal.target);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`${goal.color}22`} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={goal.color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - p) }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center" style={{ color: goal.color }}>
        <Icon name={goal.icon} className="size-[32%]" strokeWidth={2.2} />
      </div>
    </div>
  );
}

function plan(g: Goal) {
  const remain = Math.max(0, g.target - g.saved);
  if (!g.deadline || remain === 0) return null;
  const d = parseISO(g.deadline);
  const days = differenceInCalendarDays(d, new Date());
  if (days < 0) return { text: '已過期限', overdue: true };
  const months = Math.max(1, differenceInCalendarMonths(d, new Date()));
  return { text: `剩 ${days} 天 · 每月需存 ${money(Math.ceil(remain / months))}`, overdue: false };
}

export function GoalsPage() {
  const { data: goals = [], isLoading } = useGoals();
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [open, setOpen] = useState<Goal | null>(null);
  const totalSaved = goals.reduce((s, g) => s + g.saved, 0);
  const totalTarget = goals.reduce((s, g) => s + g.target, 0);
  const current = open ? (goals.find((g) => g.id === open.id) ?? null) : null;

  return (
    <div className="space-y-5">
      <PageHeader title="存錢目標" right={<Button size="sm" onClick={() => setEditing('new')}><Plus className="size-4" /> 新增</Button>} />

      {goals.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-sky-400 via-teal-500 to-emerald-500 p-6 text-white shadow-[0_20px_50px_-20px_#0d9488]">
          <div className="pointer-events-none absolute -right-10 -top-10 size-44 rounded-full bg-white/15 blur-2xl" />
          <p className="text-sm text-white/80">已存總額</p>
          <AnimatedMoney value={totalSaved} className="block text-[34px] font-extrabold" />
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/25">
            <motion.div className="h-full rounded-full bg-white" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (totalSaved / (totalTarget || 1)) * 100)}%` }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
          </div>
          <p className="num mt-2 text-xs text-white/80">目標總額 {money(totalTarget)} · {goals.length} 個目標</p>
        </motion.div>
      )}

      {!isLoading && goals.length === 0 ? (
        <div className="card">
          <Empty icon={<GoalIcon className="size-7" />} title="設定第一個存錢目標" hint="旅行、新手機、緊急預備金…" action={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> 新增目標</Button>} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((g, i) => {
            const pct = Math.min(100, (g.saved / g.target) * 100);
            const pl = plan(g);
            const done = g.saved >= g.target;
            return (
              <motion.button
                key={g.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setOpen(g)}
                className="card flex items-center gap-4 p-4 text-left"
              >
                <GoalRing goal={g} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{g.name}</p>
                  <p className="num text-lg font-extrabold">{money(g.saved)}</p>
                  <p className="num text-xs text-muted">/ {money(g.target)} · {pct.toFixed(0)}%</p>
                  {done ? (
                    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-primary"><PartyPopper className="size-3.5" /> 目標達成！</p>
                  ) : pl ? (
                    <p className={cn('mt-1 text-xs', pl.overdue ? 'font-semibold text-expense' : 'text-muted')}>{pl.text}</p>
                  ) : null}
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      <GoalDetail goal={current} onClose={() => setOpen(null)} onEdit={(g) => { setOpen(null); setEditing(g); }} />
      <GoalSheet editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function GoalDetail({ goal, onClose, onEdit }: { goal: Goal | null; onClose: () => void; onEdit: (g: Goal) => void }) {
  const { data: entries = [] } = useGoalEntries(goal?.id ?? null);
  const add = useGoalEntry();
  const delEntry = useDeleteGoalEntry();
  const toast = useUI((s) => s.toast);
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    setAmount('');
    setDir('in');
  }, [goal?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0) || !goal) return toast({ message: '請輸入金額', tone: 'error' });
    try {
      const before = goal.saved;
      const g = await add.mutateAsync({ id: goal.id, amount: dir === 'in' ? n : -n });
      setAmount('');
      if (before < g.target && g.saved >= g.target) {
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 2200);
      } else toast({ message: dir === 'in' ? `已存入 ${money(n)}` : `已提領 ${money(n)}` });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <Sheet open={!!goal} onClose={onClose} title={goal?.name}>
      {goal && (
        <div className="space-y-5">
          <div className="flex items-center gap-5">
            <GoalRing goal={goal} size={112} stroke={11} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">已存</p>
              <AnimatedMoney value={goal.saved} className="block text-3xl font-extrabold" />
              <p className="num text-sm text-muted">目標 {money(goal.target)}{goal.deadline && ` · ${fmt(parseISO(goal.deadline), 'yyyy/M/d')} 前`}</p>
              <p className="num text-sm font-medium">{goal.saved >= goal.target ? '🎉 已達成' : `還差 ${money(goal.target - goal.saved)}`}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => onEdit(goal)} aria-label="編輯目標"><Pencil className="size-4" /></Button>
          </div>

          <form onSubmit={submit} className="space-y-3 rounded-2xl bg-surface-2/60 p-3">
            <Segmented
              layoutId="goal-dir"
              size="sm"
              value={dir}
              onChange={setDir}
              options={[
                { value: 'in', label: <span className="flex items-center justify-center gap-1"><Plus className="size-3.5" />存入</span> },
                { value: 'out', label: <span className="flex items-center justify-center gap-1"><Minus className="size-3.5" />提領</span> },
              ]}
            />
            <div className="flex gap-2">
              <Input type="number" inputMode="decimal" min={0} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金額" className="bg-surface" />
              <Button type="submit" className="h-12 shrink-0 px-5" loading={add.isPending}>{dir === 'in' ? '存入' : '提領'}</Button>
            </div>
            <div className="flex gap-2">
              {[100, 500, 1000, 5000].map((n) => (
                <button key={n} type="button" onClick={() => setAmount(String((Number(amount) || 0) + n))} className="num h-8 flex-1 rounded-full bg-surface text-xs font-semibold text-muted hover:text-fg">
                  +{n.toLocaleString()}
                </button>
              ))}
            </div>
          </form>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted">紀錄</h3>
            {entries.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">還沒有存入紀錄</p>
            ) : (
              <ul className="divide-y divide-border">
                <AnimatePresence initial={false}>
                  {entries.map((e) => (
                    <motion.li key={e.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 py-2.5">
                      <span className={cn('grid size-8 place-items-center rounded-full', e.amount > 0 ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted')}>
                        {e.amount > 0 ? <Plus className="size-4" /> : <Minus className="size-4" />}
                      </span>
                      <div className="flex-1">
                        <p className="num text-sm font-semibold">{e.amount > 0 ? '存入' : '提領'} {money(Math.abs(e.amount))}</p>
                        <p className="text-xs text-muted">{e.createdAt.slice(0, 16).replace('T', ' ')}{e.note && ` · ${e.note}`}</p>
                      </div>
                      <button onClick={() => delEntry.mutate({ id: goal.id, entryId: e.id })} className="grid size-8 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-expense" aria-label="刪除紀錄">
                        <X className="size-4" />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </section>

          <AnimatePresence>{celebrate && <Celebration color={goal.color} />}</AnimatePresence>
        </div>
      )}
    </Sheet>
  );
}

function Celebration({ color }: { color: string }) {
  const bits = Array.from({ length: 28 }, (_, i) => i);
  const palette = [color, '#fbbf24', '#f472b6', '#60a5fa', '#34d399'];
  return (
    <motion.div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {bits.map((i) => {
        const a = (i / bits.length) * Math.PI * 2;
        const dist = 120 + (i % 5) * 30;
        return (
          <motion.span
            key={i}
            className="absolute size-2.5 rounded-[3px]"
            style={{ background: palette[i % palette.length] }}
            initial={{ x: 0, y: 0, rotate: 0, scale: 0.4 }}
            animate={{ x: Math.cos(a) * dist, y: Math.sin(a) * dist + 60, rotate: 360 + i * 20, scale: 1, opacity: [1, 1, 0] }}
            transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          />
        );
      })}
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }} className="rounded-3xl bg-surface px-6 py-4 text-center shadow-2xl">
        <PartyPopper className="mx-auto mb-1 size-8" style={{ color }} />
        <p className="text-lg font-extrabold">目標達成！</p>
      </motion.div>
    </motion.div>
  );
}

function GoalSheet({ editing, onClose }: { editing: Goal | 'new' | null; onClose: () => void }) {
  const save = useSaveGoal();
  const del = useDeleteGoal();
  const toast = useUI((s) => s.toast);
  const g = editing && editing !== 'new' ? editing : null;
  const [f, setF] = useState({ name: '', target: '', icon: 'piggy-bank', color: '#10b981' });
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [pick, setPick] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setPick(false);
    setF(g ? { name: g.name, target: String(g.target), icon: g.icon, color: g.color } : { name: '', target: '', icon: 'piggy-bank', color: '#10b981' });
    setDeadline(g?.deadline ? parseISO(g.deadline) : null);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const parsed = goalInput.safeParse({ ...f, target: Number(f.target) || 0, deadline: deadline ? ymd(deadline) : null });
    if (!parsed.success) return toast({ message: parsed.error.issues[0].message, tone: 'error' });
    try {
      await save.mutateAsync({ id: g?.id, data: parsed.data });
      toast({ message: g ? '目標已更新' : '目標已建立' });
      onClose();
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <>
      <Sheet
        open={!!editing}
        onClose={onClose}
        title={g ? '編輯目標' : '新增存錢目標'}
        footer={
          <div className="flex gap-3">
            {g && <Button variant="danger" size="icon" className="size-12 shrink-0" onClick={() => setConfirm(true)} aria-label="刪除"><Trash2 className="size-5" /></Button>}
            <Button className="h-12 flex-1" onClick={submit} loading={save.isPending}>儲存</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <motion.div key={f.icon + f.color} initial={{ scale: 0.8, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
              <IconTile name={f.icon} color={f.color} size={60} />
            </motion.div>
            <div className="flex-1">
              <Field label="目標名稱">
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={30} placeholder="例如：日本旅行" />
              </Field>
            </div>
          </div>
          <Field label="目標金額">
            <Input type="number" inputMode="decimal" min={0} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder="60000" />
          </Field>
          <Field label="期限（選填）">
            <button type="button" onClick={() => setPick(!pick)} className={cn('h-12 w-full rounded-2xl border bg-surface-2/60 px-4 text-left text-[15px]', pick ? 'border-primary' : 'border-border', !deadline && 'text-muted')}>
              {deadline ? fmt(deadline, 'yyyy/M/d (EEEEE)') : '不設期限'}
            </button>
          </Field>
          {pick && (
            <div className="rounded-2xl border border-border p-3">
              <Calendar value={deadline ?? new Date()} onChange={(d) => { setDeadline(d); setPick(false); }} />
              {deadline && <button type="button" className="mt-2 w-full text-sm font-semibold text-primary" onClick={() => { setDeadline(null); setPick(false); }}>清除期限</button>}
            </div>
          )}
          <Field label="顏色"><ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} /></Field>
          <Field label="圖示"><IconPicker value={f.icon} color={f.color} onChange={(icon) => setF({ ...f, icon })} /></Field>
        </div>
      </Sheet>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="刪除目標？"
        message="目標與所有存入紀錄都會刪除。"
        confirmText="刪除"
        loading={del.isPending}
        onConfirm={async () => {
          await del.mutateAsync(g!.id);
          setConfirm(false);
          onClose();
          toast({ message: '目標已刪除' });
        }}
      />
    </>
  );
}
