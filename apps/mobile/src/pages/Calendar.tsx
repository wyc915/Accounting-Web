import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek,
} from 'date-fns';
import { CalendarX2 } from 'lucide-react';
import { useTransactions, useTrend } from '@/lib/queries';
import { cn, fmt, money, ymd } from '@/lib/format';
import { useUI } from '@/stores/ui';
import { AnimatedMoney, Button, Empty, PageHeader } from '@/components/ui';
import { PeriodNav } from '@/components/PeriodNav';
import { GroupedTransactions } from '@/components/TransactionList';
import { useChartColors } from '@/components/charts';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
/** 4-step sequential scale (one hue, light → dark) */
const STEPS = [0.14, 0.32, 0.55, 0.85];

export function CalendarPage() {
  const [month, setMonth] = useState(startOfMonth(new Date()));
  const [selected, setSelected] = useState(new Date());
  const colors = useChartColors();
  const openEditor = useUI((s) => s.openEditor);

  const range = { from: ymd(month), to: ymd(addMonths(month, 1)) };
  const { data: daily = [] } = useTrend({ ...range, unit: 'day' });
  const map = useMemo(() => new Map(daily.map((d) => [d.key, d])), [daily]);
  const { data: dayTx = [], isLoading } = useTransactions({ from: ymd(selected), to: ymd(addDays(selected, 1)) });

  const maxExp = Math.max(1, ...daily.map((d) => d.expense));
  const level = (v: number) => (v <= 0 ? -1 : Math.min(3, Math.floor((v / maxExp) * 4 - 1e-9)));
  const totals = daily.reduce((a, d) => ({ income: a.income + d.income, expense: a.expense + d.expense }), { income: 0, expense: 0 });

  const days = eachDayOfInterval({
    start: startOfWeek(month, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
  const sel = map.get(ymd(selected));

  return (
    <div className="space-y-5">
      <PageHeader title="日曆" />

      <section className="card p-4 sm:p-5">
        <PeriodNav
          mode="month"
          anchor={month}
          onChange={(d) => {
            const m = startOfMonth(d);
            setMonth(m);
            setSelected(isSameMonth(new Date(), m) ? new Date() : m);
          }}
        />
        <div className="mt-2 flex justify-center gap-5 text-xs text-muted">
          <span>收入 <b className="num text-fg">{money(totals.income)}</b></span>
          <span>支出 <b className="num text-fg">{money(totals.expense)}</b></span>
        </div>

        <div className="mt-4 grid grid-cols-7 text-center text-xs text-muted">
          {WEEK.map((w) => <span key={w} className="pb-2">{w}</span>)}
        </div>
        <motion.div key={ymd(month)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {days.map((d, i) => {
            const k = ymd(d);
            const v = map.get(k);
            const lv = level(v?.expense ?? 0);
            const inMonth = isSameMonth(d, month);
            const isSel = isSameDay(d, selected);
            return (
              <motion.button
                key={k}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.008 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => setSelected(d)}
                aria-label={`${fmt(d, 'M月d日')} 支出 ${money(v?.expense ?? 0)}`}
                className={cn(
                  'relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition-shadow sm:aspect-[1.15]',
                  !inMonth && 'opacity-35',
                  isSel && 'ring-2 ring-fg',
                )}
                style={{ background: lv >= 0 ? hexA(colors.expense, STEPS[lv]) : 'var(--surface-2)' }}
              >
                <span className={cn('font-semibold', isToday(d) && 'text-primary', lv >= 2 && 'text-white')}>{d.getDate()}</span>
                {v && v.expense > 0 && (
                  <span className={cn('num hidden text-[10px] leading-none sm:block', lv >= 2 ? 'text-white/90' : 'text-muted')}>
                    {v.expense >= 10000 ? `${+(v.expense / 10000).toFixed(1)}萬` : Math.round(v.expense)}
                  </span>
                )}
                {v && v.income > 0 && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full" style={{ background: colors.income, boxShadow: `0 0 0 1.5px ${colors.surface}` }} />}
              </motion.button>
            );
          })}
        </motion.div>

        {/* legend */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            少
            {STEPS.map((s) => <span key={s} className="size-3 rounded-[4px]" style={{ background: hexA(colors.expense, s) }} />)}
            多（支出）
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: colors.income }} /> 有收入
          </span>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-lg font-bold">{fmt(selected, 'M月d日 EEEE')}</h2>
            <p className="text-sm text-muted">
              支出 <AnimatedMoney value={sel?.expense ?? 0} className="font-semibold text-fg" />
              {sel && sel.income > 0 && <> · 收入 <AnimatedMoney value={sel.income} className="font-semibold text-fg" /></>}
            </p>
          </div>
          <Button size="sm" variant="soft" onClick={() => {
            const d = new Date(selected);
            const now = new Date();
            d.setHours(now.getHours(), now.getMinutes(), 0, 0);
            openEditor(undefined, { date: d });
          }}>
            記一筆
          </Button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={ymd(selected)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {!isLoading && dayTx.length === 0 ? (
              <div className="card">
                <Empty icon={<CalendarX2 className="size-7" />} title="這天沒有紀錄" />
              </div>
            ) : (
              <GroupedTransactions items={dayTx} />
            )}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>
  );
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
