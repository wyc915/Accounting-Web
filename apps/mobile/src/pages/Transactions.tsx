import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Inbox, Search, SlidersHorizontal, X } from 'lucide-react';
import { useLookups, useSummary, useTransactions, type TxFilter } from '@/lib/queries';
import { cn, money, ymd } from '@/lib/format';
import { periodOf, shift, type Mode } from '@/lib/period';
import { IconTile } from '@/lib/icons';
import { AnimatedMoney, Button, Empty, Input, PageHeader, Segmented, Sheet } from '@/components/ui';
import { GroupedTransactions } from '@/components/TransactionList';

type Filters = Pick<TxFilter, 'type' | 'categoryIds' | 'accountIds' | 'tagIds' | 'min' | 'max'>;
const EMPTY: Filters = { type: '', categoryIds: [], accountIds: [], tagIds: [], min: '', max: '' };

export function TransactionsPage() {
  const [mode, setMode] = useState<Mode>('month');
  const [anchor, setAnchor] = useState(new Date());
  const [dir, setDir] = useState(0);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const p = periodOf(mode, anchor);
  const f: TxFilter = useMemo(
    () => ({ ...filters, q, from: p.from ? ymd(p.from) : undefined, to: p.to ? ymd(p.to) : undefined, limit: 2000 }),
    [filters, q, p.from?.getTime(), p.to?.getTime()], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { data: items = [], isLoading, isFetching } = useTransactions(f);
  const { data: sum } = useSummary(f);

  const activeCount =
    (filters.type ? 1 : 0) + filters.categoryIds!.length + filters.accountIds!.length + filters.tagIds!.length + (filters.min || filters.max ? 1 : 0);

  const go = (n: number) => {
    setDir(n);
    setAnchor((a) => shift(mode, a, n));
  };

  return (
    <div>
      <PageHeader title="明細" />

      <Segmented
        layoutId="period"
        size="sm"
        value={mode}
        onChange={(m) => { setMode(m); setAnchor(new Date()); }}
        options={[
          { value: 'day', label: '日' },
          { value: 'week', label: '週' },
          { value: 'month', label: '月' },
          { value: 'year', label: '年' },
          { value: 'all', label: '全部' },
        ]}
      />

      {/* Period nav + summary */}
      <div className="card mt-4 p-4">
        <div className="flex items-center justify-between">
          {mode !== 'all' ? (
            <button onClick={() => go(-1)} className="grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="上一期">
              <ChevronLeft className="size-5" />
            </button>
          ) : <span className="size-9" />}
          <div className="relative h-6 flex-1 overflow-hidden text-center">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.button
                key={p.label}
                initial={{ x: dir * 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: dir * -40, opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setAnchor(new Date())}
                className="w-full font-semibold"
                title="回到本期"
              >
                {p.label}
              </motion.button>
            </AnimatePresence>
          </div>
          {mode !== 'all' ? (
            <button onClick={() => go(1)} className="grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="下一期">
              <ChevronRight className="size-5" />
            </button>
          ) : <span className="size-9" />}
        </div>
        <div className="mt-3 grid grid-cols-3 divide-x divide-border text-center">
          <div>
            <p className="text-xs text-muted">收入</p>
            <AnimatedMoney value={sum?.income ?? 0} className="font-bold text-income" />
          </div>
          <div>
            <p className="text-xs text-muted">支出</p>
            <AnimatedMoney value={sum?.expense ?? 0} className="font-bold text-expense" />
          </div>
          <div>
            <p className="text-xs text-muted">結餘</p>
            <AnimatedMoney value={sum?.balance ?? 0} className="font-bold" />
          </div>
        </div>
      </div>

      {/* Search + filter */}
      <div className="sticky top-0 z-20 -mx-4 mt-4 bg-bg/85 px-4 py-2 backdrop-blur-lg sm:-mx-6 sm:px-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋備註、類別、標籤" className="h-11 pl-10 pr-9" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-label="清除">
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button variant={activeCount ? 'soft' : 'outline'} className="relative h-11" onClick={() => setFilterOpen(true)}>
            <SlidersHorizontal className="size-4" /> 篩選
            {activeCount > 0 && (
              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-white dark:text-[#06231a]">
                {activeCount}
              </motion.span>
            )}
          </Button>
        </div>
      </div>

      <div className={cn('mt-3 transition-opacity', isFetching && !isLoading && 'opacity-70')}>
        {!isLoading && items.length === 0 ? (
          <Empty icon={<Inbox className="size-7" />} title="沒有符合的紀錄" hint={q || activeCount ? '試著調整搜尋或篩選條件' : '這段期間還沒有紀錄'} />
        ) : (
          <GroupedTransactions items={items} />
        )}
      </div>

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} value={filters} onApply={setFilters} />
    </div>
  );
}

function FilterSheet({ open, onClose, value, onApply }: { open: boolean; onClose: () => void; value: Filters; onApply: (f: Filters) => void }) {
  const [v, setV] = useState(value);
  const { cats, accs, tags } = useLookups();
  useEffect(() => { if (open) setV(value); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (k: 'categoryIds' | 'accountIds' | 'tagIds', id: number) =>
    setV((s) => ({ ...s, [k]: s[k]!.includes(id) ? s[k]!.filter((x) => x !== id) : [...s[k]!, id] }));

  const parents = cats.filter((c) => c.parentId == null && (!v.type || v.type === 'transfer' ? true : c.type === v.type));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="篩選"
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => setV(EMPTY)}>重設</Button>
          <Button onClick={() => { onApply(v); onClose(); }}>套用</Button>
        </div>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-muted">類型</h3>
          <Segmented
            layoutId="f-type"
            size="sm"
            value={v.type || 'all'}
            onChange={(t) => setV({ ...v, type: t === 'all' ? '' : t, categoryIds: [] })}
            options={[
              { value: 'all', label: '全部' },
              { value: 'expense', label: '支出' },
              { value: 'income', label: '收入' },
              { value: 'transfer', label: '轉帳' },
            ]}
          />
        </section>
        {v.type !== 'transfer' && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted">類別</h3>
            <div className="flex flex-wrap gap-2">
              {parents.map((c) => (
                <Chip key={c.id} on={v.categoryIds!.includes(c.id)} onClick={() => toggle('categoryIds', c.id)}>
                  <IconTile name={c.icon} color={c.color} size={22} className="rounded-full" />
                  {c.name}
                  {!v.type && <span className="text-[10px] text-muted">{c.type === 'income' ? '收' : '支'}</span>}
                </Chip>
              ))}
            </div>
          </section>
        )}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-muted">帳戶</h3>
          <div className="flex flex-wrap gap-2">
            {accs.map((a) => (
              <Chip key={a.id} on={v.accountIds!.includes(a.id)} onClick={() => toggle('accountIds', a.id)}>
                <IconTile name={a.icon} color={a.color} size={22} className="rounded-full" />
                {a.name}
              </Chip>
            ))}
          </div>
        </section>
        {tags.length > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted">標籤</h3>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <Chip key={t.id} on={v.tagIds!.includes(t.id)} onClick={() => toggle('tagIds', t.id)}>#{t.name}</Chip>
              ))}
            </div>
          </section>
        )}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-muted">金額區間</h3>
          <div className="flex items-center gap-2">
            <Input type="number" inputMode="decimal" min={0} placeholder="最低" value={v.min} onChange={(e) => setV({ ...v, min: e.target.value })} />
            <span className="text-muted">–</span>
            <Input type="number" inputMode="decimal" min={0} placeholder="最高" value={v.max} onChange={(e) => setV({ ...v, max: e.target.value })} />
          </div>
          {v.min && v.max && +v.min > +v.max && <p className="mt-1 text-xs text-expense">最低金額大於最高金額 {money(+v.max)}</p>}
        </section>
      </div>
    </Sheet>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
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
