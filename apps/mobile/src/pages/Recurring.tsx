import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { ArrowLeftRight, CalendarClock, Plus, Repeat, Trash2 } from 'lucide-react';
import { FREQ_LABELS, FREQS, recurringInput, type Freq, type RecurringRule } from '@ledger/shared';
import { useDeleteRecurring, useLookups, useRecurring, useSaveRecurring } from '@/lib/queries';
import { cn, fmt, money, ymd } from '@/lib/format';
import { IconTile } from '@/lib/icons';
import { useUI } from '@/stores/ui';
import { Button, Confirm, Empty, Field, Input, PageHeader, Segmented, Sheet } from '@/components/ui';
import { Calendar } from '@/components/DatePicker';
import { TxFields, draftToPayload, type DraftFields } from '@/components/TxFields';
import { Toggle } from './Accounts';

const freqText = (r: Pick<RecurringRule, 'freq' | 'interval'>) => (r.interval === 1 ? `每${FREQ_LABELS[r.freq]}` : `每 ${r.interval} ${FREQ_LABELS[r.freq]}`);
const relDays = (d: string) => {
  const n = differenceInCalendarDays(parseISO(d), new Date());
  return n === 0 ? '今天' : n === 1 ? '明天' : n < 0 ? `${-n} 天前` : `${n} 天後`;
};

export function RecurringPage() {
  const { data: rules = [], isLoading } = useRecurring();
  const { catMap, accMap } = useLookups();
  const [editing, setEditing] = useState<RecurringRule | 'new' | null>(null);

  const monthly = rules
    .filter((r) => r.active && r.nextDate)
    .reduce(
      (a, r) => {
        const perMonth = r.amount * ({ daily: 30.44, weekly: 4.345, monthly: 1, yearly: 1 / 12 }[r.freq] / r.interval);
        if (r.type === 'expense') a.exp += perMonth;
        if (r.type === 'income') a.inc += perMonth;
        return a;
      },
      { exp: 0, inc: 0 },
    );

  return (
    <div className="space-y-5">
      <PageHeader
        title="定期交易"
        right={<Button size="sm" onClick={() => setEditing('new')}><Plus className="size-4" /> 新增</Button>}
      />
      <p className="-mt-3 px-1 text-sm text-muted">房租、訂閱、薪資等固定收支，到期自動入帳。</p>

      {rules.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4">
            <p className="text-xs text-muted">每月固定支出（約）</p>
            <p className="num text-xl font-extrabold">{money(Math.round(monthly.exp))}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted">每月固定收入（約）</p>
            <p className="num text-xl font-extrabold">{money(Math.round(monthly.inc))}</p>
          </div>
        </div>
      )}

      {!isLoading && rules.length === 0 ? (
        <div className="card">
          <Empty icon={<Repeat className="size-7" />} title="還沒有定期交易" hint="設定一次，之後每期自動記帳" action={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> 新增定期交易</Button>} />
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rules.map((r, i) => {
            const c = r.categoryId ? catMap.get(r.categoryId) : undefined;
            const a = accMap.get(r.accountId);
            return (
              <motion.li key={r.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <button onClick={() => setEditing(r)} className={cn('card flex w-full items-center gap-3 p-4 text-left transition-opacity', !r.active && 'opacity-55')}>
                  {r.type === 'transfer' ? (
                    <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-transfer/12 text-transfer"><ArrowLeftRight className="size-5" /></span>
                  ) : (
                    <IconTile name={c?.icon ?? 'ellipsis'} color={c?.color ?? '#94a3b8'} size={44} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.note || c?.name || (r.type === 'transfer' ? `${a?.name} → ${accMap.get(r.toAccountId!)?.name}` : '未分類')}</p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted">
                      <span className="rounded-md bg-surface-2 px-1.5 text-[11px] font-medium text-fg">{freqText(r)}</span>
                      {r.active && r.nextDate ? (
                        <span className="flex items-center gap-1"><CalendarClock className="size-3.5" /> 下次 {fmt(parseISO(r.nextDate), 'M/d')}（{relDays(r.nextDate)}）</span>
                      ) : (
                        <span>{r.active ? '已結束' : '已暫停'}</span>
                      )}
                      <span>· 已記 {r.runCount} 次</span>
                    </p>
                  </div>
                  <span className={cn('num shrink-0 text-[17px] font-bold', r.type === 'income' && 'text-income', r.type === 'transfer' && 'text-transfer')}>
                    {r.type === 'expense' ? '−' : r.type === 'income' ? '+' : ''}{money(r.amount)}
                  </span>
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}

      <RecurringSheet editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function RecurringSheet({ editing, onClose }: { editing: RecurringRule | 'new' | null; onClose: () => void }) {
  const save = useSaveRecurring();
  const del = useDeleteRecurring();
  const { accs } = useLookups();
  const toast = useUI((s) => s.toast);
  const rule = editing && editing !== 'new' ? editing : null;
  const [v, setV] = useState<DraftFields>({ type: 'expense', amount: '', accountId: null, toAccountId: null, categoryId: null, note: '' });
  const [freq, setFreq] = useState<Freq>('monthly');
  const [interval, setInterval] = useState('1');
  const [start, setStart] = useState(new Date());
  const [end, setEnd] = useState<Date | null>(null);
  const [time, setTime] = useState('09:00');
  const [active, setActive] = useState(true);
  const [pick, setPick] = useState<'start' | 'end' | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setPick(null);
    if (rule) {
      setV({ type: rule.type, amount: String(rule.amount), accountId: rule.accountId, toAccountId: rule.toAccountId, categoryId: rule.categoryId, note: rule.note });
      setFreq(rule.freq);
      setInterval(String(rule.interval));
      setStart(parseISO(rule.startDate));
      setEnd(rule.endDate ? parseISO(rule.endDate) : null);
      setTime(rule.time);
      setActive(rule.active);
    } else {
      setV({ type: 'expense', amount: '', accountId: accs[0]?.id ?? null, toAccountId: accs[1]?.id ?? null, categoryId: null, note: '' });
      setFreq('monthly');
      setInterval('1');
      setStart(new Date());
      setEnd(null);
      setTime('09:00');
      setActive(true);
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const p = draftToPayload(v);
    const parsed = recurringInput.safeParse({
      ...p,
      amount: p.amount ?? 0,
      freq,
      interval: Number(interval) || 1,
      startDate: ymd(start),
      endDate: end ? ymd(end) : null,
      time,
      active,
    });
    if (!parsed.success) return toast({ message: parsed.error.issues[0].message, tone: 'error' });
    try {
      const res = await save.mutateAsync({ id: rule?.id, data: parsed.data });
      toast({ message: res.created > 0 ? `已儲存，補記了 ${res.created} 筆到期紀錄` : '已儲存' });
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
        title={rule ? '編輯定期交易' : '新增定期交易'}
        footer={
          <div className="flex gap-3">
            {rule && (
              <Button variant="danger" size="icon" className="size-12 shrink-0" onClick={() => setConfirm(true)} aria-label="刪除">
                <Trash2 className="size-5" />
              </Button>
            )}
            <Button className="h-12 flex-1" onClick={submit} loading={save.isPending}>儲存</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <TxFields v={v} set={(p) => setV((s) => ({ ...s, ...p }))} />

          <div>
            <p className="mb-2 text-[13px] font-medium text-muted">重複頻率</p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">每</span>
              <Input type="number" min={1} max={365} value={interval} onChange={(e) => setInterval(e.target.value)} className="h-10 w-16 px-2 text-center" />
              <Segmented
                layoutId="freq"
                size="sm"
                className="flex-1"
                value={freq}
                onChange={setFreq}
                options={FREQS.map((f) => ({ value: f, label: FREQ_LABELS[f] }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日期">
              <button type="button" onClick={() => setPick(pick === 'start' ? null : 'start')} className={cn('h-12 w-full rounded-2xl border bg-surface-2/60 px-4 text-left text-[15px]', pick === 'start' ? 'border-primary' : 'border-border')}>
                {fmt(start, 'yyyy/M/d (EEEEE)')}
              </button>
            </Field>
            <Field label="結束日期">
              <button type="button" onClick={() => setPick(pick === 'end' ? null : 'end')} className={cn('h-12 w-full rounded-2xl border bg-surface-2/60 px-4 text-left text-[15px]', pick === 'end' ? 'border-primary' : 'border-border', !end && 'text-muted')}>
                {end ? fmt(end, 'yyyy/M/d (EEEEE)') : '不結束'}
              </button>
            </Field>
          </div>
          {pick && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden rounded-2xl border border-border p-3">
              <Calendar
                key={pick}
                value={pick === 'start' ? start : (end ?? start)}
                onChange={(d) => {
                  if (pick === 'start') setStart(d);
                  else setEnd(d);
                  setPick(null);
                }}
              />
              {pick === 'end' && end && (
                <button type="button" className="mt-2 w-full text-center text-sm font-semibold text-primary" onClick={() => { setEnd(null); setPick(null); }}>
                  設為不結束
                </button>
              )}
            </motion.div>
          )}
          <p className="-mt-2 text-xs text-muted">開始日期若早於今天，儲存時會自動補記已到期的紀錄。</p>

          <div className="flex items-center gap-3">
            <Field label="入帳時間">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value || '09:00')} className="h-12 w-36 rounded-2xl border border-border bg-surface-2/60 px-3 text-[15px] outline-none [color-scheme:light] dark:[color-scheme:dark]" />
            </Field>
            {rule && (
              <label className="ml-auto flex items-center gap-3 self-end pb-2.5">
                <span className="text-sm font-medium">啟用</span>
                <Toggle on={active} onChange={setActive} />
              </label>
            )}
          </div>
        </div>
      </Sheet>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="刪除定期交易？"
        message="已經產生的紀錄會保留，之後不再自動入帳。"
        confirmText="刪除"
        loading={del.isPending}
        onConfirm={async () => {
          await del.mutateAsync(rule!.id);
          setConfirm(false);
          onClose();
          toast({ message: '已刪除定期交易' });
        }}
      />
    </>
  );
}
