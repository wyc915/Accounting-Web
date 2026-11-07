import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { addDays, addMonths, startOfDay, startOfMonth } from 'date-fns';
import { format } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Receipt, Sparkles, Target } from 'lucide-react';
import { useAccounts, useBudgets, useLookups, useMe, useSummary, useTemplates, useTransactions } from '@/lib/queries';
import { TemplateChip, useApplyTemplate } from './Templates';
import { budgetStatus } from './Budgets';
import { fmt, money, ymd } from '@/lib/format';
import { IconTile } from '@/lib/icons';
import { AnimatedMoney, Button, Empty } from '@/components/ui';
import { GroupedTransactions } from '@/components/TransactionList';
import { useUI } from '@/stores/ui';

const greet = () => {
  const h = new Date().getHours();
  return h < 5 ? '夜深了' : h < 11 ? '早安' : h < 14 ? '午安' : h < 18 ? '下午好' : '晚安';
};

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } } } as const;

export function HomePage() {
  const { data: me } = useMe();
  const openEditor = useUI((s) => s.openEditor);
  const range = useMemo(() => {
    const s = startOfMonth(new Date());
    return { from: ymd(s), to: ymd(addMonths(s, 1)) };
  }, []);
  const { data: sum } = useSummary(range);
  // recent = up to today (future-dated installments / entries are excluded)
  const { data: recent = [], isLoading } = useTransactions({ limit: 12, to: ymd(addDays(startOfDay(new Date()), 1)) });
  const { data: accounts = [] } = useAccounts();
  const { catMap } = useLookups();
  const { data: templates = [] } = useTemplates();
  const { data: budgets = [] } = useBudgets(format(new Date(), 'yyyy-MM'));
  const applyTemplate = useApplyTemplate();
  const totalBudget = budgets.find((b) => b.categoryId == null);

  const net = accounts.filter((a) => a.includeInTotal).reduce((s, a) => s + a.baseBalance, 0);
  const top = (sum?.byCategory ?? []).slice(0, 5);
  const maxCat = Math.max(1, ...top.map((c) => c.amount));
  const daysPassed = new Date().getDate();

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={item}>
        <p className="text-sm text-muted">{greet()}，{me?.name}</p>
        <h1 className="text-[26px] font-extrabold tracking-tight">{fmt(new Date(), 'M 月 d 日 EEEE')}</h1>
      </motion.div>

      {templates.length > 0 && (
        <motion.div variants={item} className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-6 sm:px-6">
          {templates.map((t) => (
            <TemplateChip key={t.id} t={t} onClick={() => applyTemplate(t)} />
          ))}
          <Link to="/templates" className="grid h-12 shrink-0 place-items-center rounded-2xl border border-dashed border-border px-3.5 text-sm text-muted hover:text-fg">
            管理
          </Link>
        </motion.div>
      )}

      {/* Hero card */}
      <motion.section
        variants={item}
        className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-600 p-6 text-white shadow-[0_20px_50px_-20px_#059669]"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 size-48 rounded-full bg-teal-300/30 blur-2xl" />
        <div className="relative">
          <p className="text-sm font-medium text-white/80">{fmt(new Date(), 'M 月')}結餘</p>
          <AnimatedMoney value={sum?.balance ?? 0} className="mt-1 block text-[40px] font-extrabold leading-tight" />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/15 p-3 backdrop-blur">
              <p className="flex items-center gap-1 text-xs text-white/80">
                <ArrowDownRight className="size-3.5" /> 收入
              </p>
              <AnimatedMoney value={sum?.income ?? 0} className="text-lg font-bold" />
            </div>
            <div className="rounded-2xl bg-white/15 p-3 backdrop-blur">
              <p className="flex items-center gap-1 text-xs text-white/80">
                <ArrowUpRight className="size-3.5" /> 支出
              </p>
              <AnimatedMoney value={sum?.expense ?? 0} className="text-lg font-bold" />
            </div>
          </div>
          <p className="mt-4 text-xs text-white/75">
            日均支出 {money(Math.round(((sum?.expense ?? 0) / daysPassed) * 100) / 100)} · 共 {sum?.count ?? 0} 筆
          </p>
        </div>
      </motion.section>

      {totalBudget ? (
        <motion.div variants={item}>
          <Link to="/budgets" className="card block p-5">
            {(() => {
              const st = budgetStatus(totalBudget);
              const pct = Math.min(100, (totalBudget.spent / totalBudget.amount) * 100);
              return (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="flex items-center gap-2 font-semibold"><Target className="size-4 text-primary" /> 本月預算</h2>
                    <span className="flex items-center gap-1 text-xs font-medium" style={{ color: st.color }}><st.Icon className="size-3.5" />{st.label}</span>
                  </div>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2">
                    <motion.div className="h-full rounded-full" style={{ background: st.tone === 'ok' ? 'var(--primary)' : st.color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }} />
                  </div>
                  <div className="num mt-2 flex justify-between text-sm">
                    <span className="text-muted">已花 <b className="text-fg">{money(totalBudget.spent)}</b></span>
                    <span className="text-muted">{totalBudget.amount >= totalBudget.spent ? '剩' : '超支'} <b className="text-fg">{money(Math.abs(totalBudget.amount - totalBudget.spent))}</b> / {money(totalBudget.amount)}</span>
                  </div>
                </>
              );
            })()}
          </Link>
        </motion.div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Net worth */}
        <motion.section variants={item} className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">淨資產</h2>
            <Link to="/accounts" className="flex items-center text-xs text-muted hover:text-fg">
              帳戶 <ChevronRight className="size-3.5" />
            </Link>
          </div>
          <AnimatedMoney value={net} className="mt-1 block text-2xl font-extrabold" />
          <div className="mt-4 space-y-2.5">
            {accounts.slice(0, 4).map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-sm">
                <IconTile name={a.icon} color={a.color} size={30} className="rounded-xl" />
                <span className="flex-1 truncate">{a.name}</span>
                <span className={'num font-semibold ' + (a.balance < 0 ? 'text-expense' : '')}>{money(a.balance, { currency: a.currency })}</span>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Top categories */}
        <motion.section variants={item} className="card p-5">
          <h2 className="font-semibold">本月支出排行</h2>
          {top.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted">本月還沒有支出</p>
          ) : (
            <div className="mt-4 space-y-3.5">
              {top.map((c, i) => {
                const cat = c.categoryId ? catMap.get(c.categoryId) : undefined;
                const pct = (sum!.expense ? (c.amount / sum!.expense) * 100 : 0).toFixed(0);
                return (
                  <div key={c.categoryId ?? 'none'} className="flex items-center gap-3">
                    <IconTile name={cat?.icon ?? 'ellipsis'} color={cat?.color ?? '#94a3b8'} size={30} className="rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between text-sm">
                        <span className="truncate">{cat?.name ?? '未分類'}</span>
                        <span className="num font-semibold">{money(c.amount)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: cat?.color ?? '#94a3b8' }}
                          initial={{ width: 0 }}
                          animate={{ width: `${(c.amount / maxCat) * 100}%` }}
                          transition={{ duration: 0.9, delay: 0.2 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                    </div>
                    <span className="num w-9 text-right text-xs text-muted">{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </motion.section>
      </div>

      {/* Recent */}
      <motion.section variants={item}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">最近紀錄</h2>
          <Link to="/transactions" className="flex items-center text-sm text-muted hover:text-fg">
            全部 <ChevronRight className="size-4" />
          </Link>
        </div>
        {!isLoading && recent.length === 0 ? (
          <div className="card">
            <Empty
              icon={<Sparkles className="size-7" />}
              title="開始記下第一筆吧"
              hint="點擊下方 + 按鈕，或按鍵盤 N"
              action={
                <Button onClick={() => openEditor()}>
                  <Receipt className="size-4" /> 記一筆
                </Button>
              }
            />
          </div>
        ) : (
          <GroupedTransactions items={recent} />
        )}
      </motion.section>
    </motion.div>
  );
}
