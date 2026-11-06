import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Coins, Plus, Trash2 } from 'lucide-react';
import { CURRENCIES, CURRENCY_CODES, type Currency, type ExchangeRate, type User } from '@ledger/shared';
import { api } from '@/lib/api';
import { useAccounts, useDeleteRate, useMe, useRates, useSaveRate } from '@/lib/queries';
import { cn, fmt, parseDT } from '@/lib/format';
import { useUI } from '@/stores/ui';
import { BackLink } from '@/components/BackLink';
import { Button, Confirm, Empty, Field, Input, PageHeader, Sheet } from '@/components/ui';

export function CurrencySelect({
  value, onChange, exclude = [], only, disabled,
}: {
  value: Currency;
  onChange: (c: Currency) => void;
  exclude?: string[];
  /** restrict the list (e.g. base + currencies that have a rate) */
  only?: string[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Currency)}
      className="h-12 w-full rounded-2xl border border-border bg-surface-2/60 px-4 text-[15px] text-fg outline-none focus:border-primary disabled:opacity-60"
    >
      {CURRENCY_CODES.filter((c) => c === value || (!exclude.includes(c) && (!only || only.includes(c)))).map((c) => (
        <option key={c} value={c}>
          {c} · {CURRENCIES[c].name}（{CURRENCIES[c].symbol.trim()}）
        </option>
      ))}
    </select>
  );
}

export function CurrencyPage() {
  const { data: me } = useMe();
  const { data: rates = [], isLoading } = useRates();
  const { data: accounts = [] } = useAccounts();
  const del = useDeleteRate();
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [editing, setEditing] = useState<Partial<ExchangeRate> | null>(null);
  const [baseOpen, setBaseOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const base = me?.baseCurrency ?? 'TWD';
  const hasForeign = accounts.some((a) => a.currency !== base);

  const changeBase = async (c: Currency) => {
    try {
      await api.put('/settings/base-currency', { baseCurrency: c });
      qc.setQueryData<User>(['me'], (m) => (m ? { ...m, baseCurrency: c } : m));
      await qc.invalidateQueries();
      toast({ message: `主要幣別已改為 ${c}` });
      setBaseOpen(false);
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };

  return (
    <div className="space-y-5">
      <BackLink to="/settings" label="更多" />
      <PageHeader title="幣別與匯率" right={<Button size="sm" onClick={() => setEditing({})}><Plus className="size-4" /> 新增匯率</Button>} />

      <button onClick={() => setBaseOpen(true)} className="card flex w-full items-center gap-4 p-5 text-left">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-lg font-extrabold text-primary-strong dark:text-primary">
          {CURRENCIES[base].symbol.trim()}
        </span>
        <div className="flex-1">
          <p className="text-sm text-muted">主要幣別（報表、預算、淨資產的計算基準）</p>
          <p className="text-lg font-bold">{base} · {CURRENCIES[base].name}</p>
        </div>
        <span className="text-sm text-primary">變更</span>
      </button>

      <section>
        <h2 className="mb-2 px-1 text-sm font-semibold text-muted">外幣匯率（手動設定）</h2>
        {!isLoading && rates.length === 0 ? (
          <div className="card">
            <Empty icon={<Coins className="size-7" />} title="還沒有外幣" hint="新增匯率後，就能建立外幣帳戶（例如日幣現金、美元帳戶）" />
          </div>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {rates.map((r, i) => (
              <motion.li key={r.currency} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
                <button onClick={() => setEditing(r)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2/50">
                  <span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-sm font-bold">{r.currency}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{CURRENCIES[r.currency].name}</p>
                    <p className="text-xs text-muted">更新於 {fmt(parseDT(r.updatedAt.replace(' ', 'T') + 'Z'), 'yyyy/M/d HH:mm')}</p>
                  </div>
                  <div className="num text-right">
                    <p className="font-bold">1 {r.currency} = {r.rate} {base}</p>
                    <p className="text-xs text-muted">1 {base} ≈ {+(1 / r.rate).toPrecision(4)} {r.currency}</p>
                  </div>
                </button>
              </motion.li>
            ))}
          </ul>
        )}
        <p className="mt-2 px-1 text-xs leading-relaxed text-muted">
          每筆外幣紀錄會以「記帳當下」的匯率換算成主要幣別保存；之後調整匯率只影響新紀錄與帳戶淨資產的即時換算。
        </p>
      </section>

      <RateSheet editing={editing} base={base} existing={rates.map((r) => r.currency)} onClose={() => setEditing(null)} onDelete={(c) => setConfirmDel(c)} />

      <Sheet open={baseOpen} onClose={() => setBaseOpen(false)} title="變更主要幣別">
        {hasForeign ? (
          <p className="rounded-2xl bg-amber-500/10 p-4 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
            已有外幣帳戶時無法變更主要幣別，以免歷史換算失真。如需變更，請先刪除或改回外幣帳戶。
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">所有帳戶將一併改為新的主要幣別（目前沒有外幣帳戶，金額不會換算）。</p>
            <div className="grid grid-cols-2 gap-2">
              {CURRENCY_CODES.map((c) => (
                <button
                  key={c}
                  onClick={() => changeBase(c)}
                  className={cn('flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm', c === base ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-2')}
                >
                  <b className="w-10">{c}</b>
                  <span className="truncate text-muted">{CURRENCIES[c].name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Sheet>

      <Confirm
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title={`刪除 ${confirmDel} 匯率？`}
        message="仍有帳戶使用此幣別時無法刪除。"
        confirmText="刪除"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(confirmDel!);
            toast({ message: '已刪除匯率' });
            setEditing(null);
          } catch (e) {
            toast({ message: (e as Error).message, tone: 'error' });
          }
          setConfirmDel(null);
        }}
      />
    </div>
  );
}

function RateSheet({ editing, base, existing, onClose, onDelete }: { editing: Partial<ExchangeRate> | null; base: Currency; existing: string[]; onClose: () => void; onDelete: (c: string) => void }) {
  const save = useSaveRate();
  const toast = useUI((s) => s.toast);
  const isEdit = !!editing?.currency;
  const firstFree = CURRENCY_CODES.find((c) => c !== base && !existing.includes(c)) ?? 'USD';
  const [cur, setCur] = useState<Currency>(firstFree);
  const [rate, setRate] = useState('');
  const [inverse, setInverse] = useState(false);
  const [key, setKey] = useState<unknown>(null);
  if (editing !== key) {
    setKey(editing);
    if (editing) {
      setCur((editing.currency as Currency) ?? firstFree);
      setRate(editing.rate ? String(editing.rate) : '');
      setInverse(false);
    }
  }

  const n = Number(rate);
  const effective = inverse && n > 0 ? 1 / n : n;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(effective > 0)) return toast({ message: '請輸入匯率', tone: 'error' });
    try {
      await save.mutateAsync({ currency: cur, rate: +effective.toPrecision(8) });
      toast({ message: `已儲存 ${cur} 匯率` });
      onClose();
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  return (
    <Sheet open={!!editing} onClose={onClose} title={isEdit ? `${cur} 匯率` : '新增外幣匯率'}>
      <form onSubmit={submit} className="space-y-5">
        {!isEdit && (
          <Field label="外幣">
            <CurrencySelect value={cur} onChange={setCur} exclude={[base, ...existing]} />
          </Field>
        )}
        <Field label={inverse ? `1 ${base} = ? ${cur}` : `1 ${cur} = ? ${base}`}>
          <div className="flex gap-2">
            <Input type="number" inputMode="decimal" min={0} step="any" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={inverse ? '例如 4.76' : '例如 0.21'} autoFocus />
            <Button type="button" variant="outline" size="icon" className="size-12 shrink-0" onClick={() => { setInverse(!inverse); if (n > 0) setRate(String(+(1 / n).toPrecision(6))); }} aria-label="反轉匯率方向" title="反轉方向">
              <ArrowLeftRight className="size-4" />
            </Button>
          </div>
        </Field>
        {effective > 0 && (
          <p className="num rounded-2xl bg-surface-2/60 px-4 py-3 text-sm">
            1 {cur} = <b>{+effective.toPrecision(6)}</b> {base} · 1 {base} = <b>{+(1 / effective).toPrecision(6)}</b> {cur}
          </p>
        )}
        <div className="flex gap-3">
          {isEdit && (
            <Button type="button" variant="danger" size="icon" className="size-12 shrink-0" onClick={() => onDelete(cur)} aria-label="刪除匯率">
              <Trash2 className="size-5" />
            </Button>
          )}
          <Button type="submit" className="h-12 flex-1" loading={save.isPending}>儲存</Button>
        </div>
      </form>
    </Sheet>
  );
}
