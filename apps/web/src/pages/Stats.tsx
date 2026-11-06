import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { addDays, addMonths, differenceInCalendarDays, eachDayOfInterval, eachMonthOfInterval, min, startOfDay, startOfMonth, subDays } from 'date-fns';
import { ArrowLeft, ChartPie } from 'lucide-react';
import { useCategoryStats, useLookups, useTrend } from '@/lib/queries';
import { cn, fmt, money, ymd } from '@/lib/format';
import { periodOf, type Mode } from '@/lib/period';
import { IconTile } from '@/lib/icons';
import { AnimatedMoney, Empty, PageHeader, Segmented } from '@/components/ui';
import { PeriodNav } from '@/components/PeriodNav';
import { Legend, TooltipCard, shortMoney, useChartColors } from '@/components/charts';

type StatMode = Extract<Mode, 'week' | 'month' | 'year'>;
const UNCATEGORIZED = '#94a3b8';

export function StatsPage() {
  const [mode, setMode] = useState<StatMode>('month');
  const [anchor, setAnchor] = useState(new Date());
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [parentId, setParentId] = useState<number | null>(null);
  const colors = useChartColors();
  const { catMap } = useLookups();

  const p = periodOf(mode, anchor);
  const range = { from: ymd(p.from!), to: ymd(p.to!) };
  const unit = mode === 'year' ? 'month' : 'day';
  const { data: cats = [], isLoading } = useCategoryStats({ ...range, type, parentId });
  const { data: trend = [] } = useTrend({ ...range, unit });

  // 6-month comparison ending at anchor month
  const cmpStart = startOfMonth(addMonths(anchor, -5));
  const cmpRange = { from: ymd(cmpStart), to: ymd(addMonths(startOfMonth(anchor), 1)) };
  const { data: cmp = [] } = useTrend({ ...cmpRange, unit: 'month' });

  const total = cats.reduce((s, c) => s + c.amount, 0);
  const totals = trend.reduce((a, t) => ({ income: a.income + t.income, expense: a.expense + t.expense }), { income: 0, expense: 0 });

  // fill gaps so the x-axis is continuous
  const trendData = useMemo(() => {
    const map = new Map(trend.map((t) => [t.key, t]));
    const keys =
      unit === 'month'
        ? eachMonthOfInterval({ start: p.from!, end: subDays(p.to!, 1) }).map((d) => fmt(d, 'yyyy-MM'))
        : eachDayOfInterval({ start: p.from!, end: subDays(p.to!, 1) }).map((d) => fmt(d, 'yyyy-MM-dd'));
    return keys.map((k) => ({ key: k, income: map.get(k)?.income ?? 0, expense: map.get(k)?.expense ?? 0 }));
  }, [trend, unit, p.from?.getTime(), p.to?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const cmpData = useMemo(() => {
    const map = new Map(cmp.map((t) => [t.key, t]));
    return eachMonthOfInterval({ start: cmpStart, end: startOfMonth(anchor) }).map((d) => {
      const k = fmt(d, 'yyyy-MM');
      return { key: k, label: fmt(d, 'M月'), income: map.get(k)?.income ?? 0, expense: map.get(k)?.expense ?? 0 };
    });
  }, [cmp, anchor.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const slices = cats.map((c) => {
    const cat = c.categoryId ? catMap.get(c.categoryId) : undefined;
    return {
      ...c,
      name: cat ? (parentId && cat.id === parentId ? `${cat.name}（未細分）` : cat.name) : '未分類',
      color: cat?.color ?? UNCATEGORIZED,
      icon: cat?.icon ?? 'ellipsis',
      hasChildren: !parentId && !!cat && [...catMap.values()].some((x) => x.parentId === cat.id),
    };
  });
  // For drill-down, sub-categories share the parent hue → vary opacity so slices stay distinguishable
  const sliceFill = (i: number, color: string) => (parentId ? color + ['', 'cc', '99', '77', '55', '44'][i % 6] : color);

  const parent = parentId ? catMap.get(parentId) : undefined;
  const xTick = (k: string) => (unit === 'month' ? `${+k.slice(5)}月` : `${+k.slice(8)}`);
  // elapsed days in the period (a running period counts only up to today)
  const days = Math.max(1, differenceInCalendarDays(min([p.to!, addDays(startOfDay(new Date()), 1)]), p.from!));

  return (
    <div className="space-y-5">
      <PageHeader title="報表" />

      <div className="flex flex-wrap gap-3">
        <Segmented
          layoutId="stat-mode"
          size="sm"
          className="min-w-[200px] flex-1"
          value={mode}
          onChange={(m) => { setMode(m); setAnchor(new Date()); }}
          options={[
            { value: 'week', label: '週' },
            { value: 'month', label: '月' },
            { value: 'year', label: '年' },
          ]}
        />
        <Segmented
          layoutId="stat-type"
          size="sm"
          className="min-w-[160px] flex-1"
          value={type}
          onChange={(t) => { setType(t); setParentId(null); }}
          options={[
            { value: 'expense', label: '支出' },
            { value: 'income', label: '收入' },
          ]}
        />
      </div>

      <div className="card p-4">
        <PeriodNav mode={mode} anchor={anchor} onChange={setAnchor} />
        <div className="mt-3 grid grid-cols-3 divide-x divide-border text-center">
          <div>
            <p className="text-xs text-muted">收入</p>
            <AnimatedMoney value={totals.income} className="font-bold" />
          </div>
          <div>
            <p className="text-xs text-muted">支出</p>
            <AnimatedMoney value={totals.expense} className="font-bold" />
          </div>
          <div>
            <p className="text-xs text-muted">日均支出</p>
            <AnimatedMoney value={Math.round((totals.expense / Math.max(1, days)) * 100) / 100} className="font-bold" />
          </div>
        </div>
      </div>

      {/* Category breakdown */}
      <section className="card p-5">
        <div className="mb-2 flex items-center gap-2">
          <AnimatePresence initial={false}>
            {parent && (
              <motion.button
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                onClick={() => setParentId(null)}
                className="grid size-8 place-items-center overflow-hidden rounded-full bg-surface-2"
                aria-label="返回"
              >
                <ArrowLeft className="size-4" />
              </motion.button>
            )}
          </AnimatePresence>
          <h2 className="font-semibold">{parent ? `${parent.name} 細項` : `${type === 'expense' ? '支出' : '收入'}類別占比`}</h2>
        </div>

        {slices.length === 0 ? (
          isLoading ? <div className="h-60" /> : <Empty icon={<ChartPie className="size-7" />} title="這段期間沒有資料" hint="換個期間或先記幾筆吧" />
        ) : (
          <div className="grid items-center gap-4 md:grid-cols-[240px_1fr]">
            <div className="relative mx-auto aspect-square w-full max-w-[240px]">
              <motion.div
                key={`${range.from}-${type}-${parentId}`}
                className="size-full"
                initial={{ rotate: -100, scale: 0.82, opacity: 0 }}
                animate={{ rotate: 0, scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 140, damping: 20 }}
              >
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="amount"
                    nameKey="name"
                    innerRadius="68%"
                    outerRadius="100%"
                    paddingAngle={slices.length > 1 ? 1.5 : 0}
                    cornerRadius={slices.length > 1 ? 4 : 0}
                    stroke={colors.surface}
                    strokeWidth={2}
                    isAnimationActive={false}
                    onClick={(_, i) => slices[i].hasChildren && setParentId(slices[i].categoryId)}
                  >
                    {slices.map((s, i) => (
                      <Cell key={s.categoryId ?? 'none'} fill={sliceFill(i, s.color)} className={cn(s.hasChildren && 'cursor-pointer')} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <TooltipCard
                          title={`${((Number(payload[0].value) / total) * 100).toFixed(1)}%`}
                          rows={[{ color: String(payload[0].payload.color), label: String(payload[0].name), value: Number(payload[0].value) }]}
                        />
                      ) : null
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              </motion.div>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div>
                  <p className="text-xs text-muted">{parent ? parent.name : type === 'expense' ? '總支出' : '總收入'}</p>
                  <AnimatedMoney value={total} className="text-xl font-extrabold" />
                </div>
              </div>
            </div>

            {/* ranking = legend + table view */}
            <ul className="space-y-1">
              {slices.map((s, i) => (
                <motion.li
                  key={`${parentId}-${s.categoryId}`}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <button
                    disabled={!s.hasChildren}
                    onClick={() => setParentId(s.categoryId)}
                    className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left', s.hasChildren && 'hover:bg-surface-2')}
                  >
                    <IconTile name={s.icon} color={s.color} size={34} className="rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium">
                          {s.name}
                          <span className="ml-1.5 text-xs text-muted">{s.count} 筆</span>
                        </span>
                        <span className="num shrink-0 font-semibold">{money(s.amount)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: sliceFill(i, s.color) }}
                            initial={{ width: 0 }}
                            animate={{ width: `${(s.amount / (slices[0]?.amount || 1)) * 100}%` }}
                            transition={{ duration: 0.8, delay: 0.1 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                          />
                        </div>
                        <span className="num w-11 text-right text-xs text-muted">{((s.amount / (total || 1)) * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  </button>
                </motion.li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Trend */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">收支趨勢</h2>
          <Legend items={[{ color: colors.income, label: '收入' }, { color: colors.expense, label: '支出' }]} />
        </div>
        <div className="h-56">
          <ResponsiveContainer>
            <AreaChart data={trendData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="g-inc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={colors.income} stopOpacity={0.22} />
                  <stop offset="1" stopColor={colors.income} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="g-exp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={colors.expense} stopOpacity={0.22} />
                  <stop offset="1" stopColor={colors.expense} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={colors.grid} />
              <XAxis dataKey="key" tickFormatter={xTick} tick={{ fill: colors.muted, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={12} />
              <YAxis tickFormatter={shortMoney} tick={{ fill: colors.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                cursor={{ stroke: colors.muted, strokeDasharray: '3 3' }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <TooltipCard
                      title={unit === 'month' ? `${String(label).slice(0, 4)} 年 ${+String(label).slice(5)} 月` : fmt(new Date(String(label)), 'M月d日 EEEE')}
                      rows={[
                        { color: colors.income, label: '收入', value: Number(payload.find((x) => x.dataKey === 'income')?.value ?? 0) },
                        { color: colors.expense, label: '支出', value: Number(payload.find((x) => x.dataKey === 'expense')?.value ?? 0) },
                      ]}
                    />
                  ) : null
                }
              />
              <Area type="monotone" dataKey="income" stroke={colors.income} strokeWidth={2} fill="url(#g-inc)" activeDot={{ r: 5, stroke: colors.surface, strokeWidth: 2 }} animationDuration={800} />
              <Area type="monotone" dataKey="expense" stroke={colors.expense} strokeWidth={2} fill="url(#g-exp)" activeDot={{ r: 5, stroke: colors.surface, strokeWidth: 2 }} animationDuration={800} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Monthly comparison */}
      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">近 6 個月對比</h2>
          <Legend items={[{ color: colors.income, label: '收入' }, { color: colors.expense, label: '支出' }]} />
        </div>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={cmpData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barGap={2} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={colors.grid} />
              <XAxis dataKey="label" tick={{ fill: colors.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={shortMoney} tick={{ fill: colors.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                cursor={{ fill: colors.grid, opacity: 0.5, radius: 8 } as object}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <TooltipCard
                      title={String(label)}
                      rows={[
                        { color: colors.income, label: '收入', value: Number(payload[0]?.payload.income ?? 0) },
                        { color: colors.expense, label: '支出', value: Number(payload[0]?.payload.expense ?? 0) },
                        { color: 'transparent', label: '結餘', value: Number(payload[0]?.payload.income ?? 0) - Number(payload[0]?.payload.expense ?? 0) },
                      ]}
                    />
                  ) : null
                }
              />
              <Bar dataKey="income" fill={colors.income} radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={700} />
              <Bar dataKey="expense" fill={colors.expense} radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={700} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
