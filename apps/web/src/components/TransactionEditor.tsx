import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookmarkPlus, Camera, Hash, Layers, Plus, Trash2, X } from 'lucide-react';
import { checkBudgetAlert } from '@/lib/budgetAlert';
import type { Category, Currency, TxType } from '@ledger/shared';
import { useUI } from '@/stores/ui';
import {
  useCreateInstallment, useCreateTag, useDeleteTransaction, useLookups, useMe, useRates, useRestoreTransaction, useSaveTemplate,
  useSaveTransaction,
} from '@/lib/queries';
import { api, compressImage } from '@/lib/api';
import { evaluate, hasOperator } from '@/lib/calc';
import { cn, fmt, money, parseDT, symbolOf, toLocalDT, ymd } from '@/lib/format';
import { Toggle } from '@/pages/Accounts';
import { IconTile } from '@/lib/icons';
import { Button, Segmented, Sheet, spring } from './ui';
import { DateTimePicker } from './DatePicker';
import { Keypad } from './Keypad';

const ACCENT: Record<TxType, string> = { expense: 'var(--expense)', income: 'var(--income)', transfer: 'var(--transfer)' };
const LAST_ACC = 'lastAccountId';

export function TransactionEditor() {
  const { editor, closeEditor } = useUI();
  return (
    <Sheet open={!!editor} onClose={closeEditor} title={editor?.tx ? '編輯紀錄' : '記一筆'}>
      {editor && <EditorBody key={editor.nonce} />}
    </Sheet>
  );
}

function EditorBody() {
  const { editor, closeEditor, toast } = useUI();
  const editing = editor?.tx;
  const draft = editor?.draft;
  const saveTpl = useSaveTemplate();
  const { cats, accs, tags } = useLookups();
  const save = useSaveTransaction();
  const del = useDeleteTransaction();
  const restore = useRestoreTransaction();
  const createTag = useCreateTag();

  const [type, setType] = useState<TxType>(editing?.type ?? draft?.type ?? 'expense');
  const [expr, setExpr] = useState(editing ? String(editing.amount) : draft?.amount ? String(draft.amount) : '');
  const [date, setDate] = useState<Date>(editing ? parseDT(editing.occurredAt) : (draft?.date ?? new Date()));
  const [categoryId, setCategoryId] = useState<number | null>(editing?.categoryId ?? draft?.categoryId ?? null);
  const [accountId, setAccountId] = useState<number | null>(editing?.accountId ?? draft?.accountId ?? null);
  const [toAccountId, setToAccountId] = useState<number | null>(editing?.toAccountId ?? draft?.toAccountId ?? null);
  const [note, setNote] = useState(editing?.note ?? draft?.note ?? '');
  const [tagIds, setTagIds] = useState<number[]>(editing?.tagIds ?? []);
  const [newTag, setNewTag] = useState('');
  const [showTags, setShowTags] = useState((editing?.tagIds.length ?? 0) > 0);
  // Phase 3
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: rates = [] } = useRates();
  const createInst = useCreateInstallment();
  const [installment, setInstallment] = useState(!editing && !!draft?.installment);
  const [periods, setPeriods] = useState(6);
  const [toAmountStr, setToAmountStr] = useState(editing?.toAmount != null ? String(editing.toAmount) : '');
  const [keptPhotos, setKeptPhotos] = useState<number[]>(editing?.attachmentIds ?? []);
  const [newPhotos, setNewPhotos] = useState<{ file: File; url: string }[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => () => newPhotos.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // default account
  useEffect(() => {
    if (accountId != null || !accs.length) return;
    let last: number | null = null;
    try {
      last = Number(localStorage.getItem(LAST_ACC)) || null;
    } catch { /* ignore */ }
    setAccountId(accs.find((a) => a.id === last)?.id ?? accs[0].id);
  }, [accs, accountId]);
  useEffect(() => {
    if (type === 'transfer' && toAccountId == null && accs.length > 1)
      setToAccountId(accs.find((a) => a.id !== accountId)?.id ?? null);
  }, [type, accs, accountId, toAccountId]);

  const parents = useMemo(() => cats.filter((c) => c.type === type && c.parentId == null), [cats, type]);
  const children = (pid: number) => cats.filter((c) => c.parentId === pid);
  const selected = cats.find((c) => c.id === categoryId);
  const activeParentId = selected ? (selected.parentId ?? selected.id) : null;

  // reset category on type switch if mismatched
  useEffect(() => {
    if (selected && selected.type !== type) setCategoryId(null);
  }, [type, selected]);

  const amount = evaluate(expr) ?? 0;

  /* ---- currency ---- */
  const base = me?.baseCurrency ?? 'TWD';
  const acc = accs.find((a) => a.id === accountId);
  const toAcc = accs.find((a) => a.id === toAccountId);
  const cur: Currency = acc?.currency ?? base;
  const rateOf = (c: Currency) => (c === base ? 1 : (rates.find((r) => r.currency === c)?.rate ?? 1));
  const crossCurrency = type === 'transfer' && !!toAcc && toAcc.currency !== cur;
  const autoToAmount = crossCurrency ? Math.round(((amount * rateOf(cur)) / rateOf(toAcc!.currency)) * 100) / 100 : amount;
  const toAmount = crossCurrency ? (toAmountStr ? Number(toAmountStr) : autoToAmount) : null;
  const baseHint = cur !== base && amount > 0 ? `≈ ${money(Math.round(amount * rateOf(cur) * 100) / 100)}` : null;
  const instMode = installment && type === 'expense' && !editing;

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const room = 10 - keptPhotos.length - newPhotos.length;
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    setNewPhotos((p) => [...p, ...list.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };

  /** upload new photos / delete removed ones after the transaction is saved */
  const syncPhotos = async (txId: number) => {
    const removed = (editing?.attachmentIds ?? []).filter((id) => !keptPhotos.includes(id));
    if (!newPhotos.length && !removed.length) return;
    setUploading(true);
    try {
      for (const id of removed) await api.del(`/attachments/${id}`);
      for (const p of newPhotos) await api.upload(`/transactions/${txId}/attachments`, await compressImage(p.file), 'receipt.jpg');
    } finally {
      setUploading(false);
      qc.invalidateQueries({ queryKey: ['transactions'] });
    }
  };

  const submit = async () => {
    if (save.isPending || createInst.isPending || uploading) return;
    if (!(amount > 0)) return toast({ message: '請輸入金額', tone: 'error' });
    if (!accountId) return toast({ message: '請選擇帳戶', tone: 'error' });
    if (type !== 'transfer' && !categoryId) return toast({ message: '請選擇類別', tone: 'error' });
    if (type === 'transfer' && (!toAccountId || toAccountId === accountId))
      return toast({ message: '請選擇不同的轉入帳戶', tone: 'error' });
    if (crossCurrency && !(toAmount! > 0)) return toast({ message: '請輸入轉入金額', tone: 'error' });
    try {
      if (instMode) {
        const name = (note.trim() || cats.find((c) => c.id === categoryId)?.name || '分期').slice(0, 40);
        await createInst.mutateAsync({ name, total: amount, periods, accountId, categoryId, startDate: ymd(date), time: fmt(date, 'HH:mm') });
        toast({ message: `已建立分期「${name}」${periods} 期` });
        closeEditor();
        return;
      }
      const tx = await save.mutateAsync({
        id: editing?.id,
        data: {
          type,
          amount,
          accountId,
          toAccountId: type === 'transfer' ? toAccountId : null,
          toAmount: crossCurrency ? toAmount : null,
          categoryId: type === 'transfer' ? null : categoryId,
          occurredAt: toLocalDT(date),
          note: note.trim(),
          tagIds,
        },
      });
      try {
        localStorage.setItem(LAST_ACC, String(accountId));
      } catch { /* ignore */ }
      await syncPhotos(tx.id);
      toast({ message: editing ? '已更新' : `已記下 ${money(amount, { currency: cur })}` });
      closeEditor();
      if (type === 'expense') checkBudgetAlert(date, categoryId, cats);
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };

  const saveAsTemplate = async () => {
    const cat = cats.find((c) => c.id === categoryId);
    const name = (note.trim() || cat?.name || (type === 'transfer' ? '轉帳' : '模板')).slice(0, 20);
    try {
      await saveTpl.mutateAsync({
        data: {
          name,
          type,
          amount: amount > 0 ? amount : null,
          accountId,
          toAccountId: type === 'transfer' ? toAccountId : null,
          categoryId: type === 'transfer' ? null : categoryId,
          note: note.trim(),
        },
      });
      toast({ message: `已存為模板「${name}」` });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  const onDelete = async () => {
    if (!editing) return;
    closeEditor();
    await del.mutateAsync(editing.id);
    toast({ message: '已刪除紀錄', action: { label: '復原', onClick: () => restore.mutate(editing.id) }, duration: 6000 });
  };

  const addTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    const t = await createTag.mutateAsync(name);
    setTagIds((ids) => (ids.includes(t.id) ? ids : [...ids, t.id]));
    setNewTag('');
  };

  return (
    <div className="space-y-4">
      <Segmented
        layoutId="tx-type"
        value={type}
        onChange={setType}
        options={[
          { value: 'expense', label: '支出', activeClass: 'text-expense' },
          { value: 'income', label: '收入', activeClass: 'text-income' },
          { value: 'transfer', label: '轉帳', activeClass: 'text-transfer' },
        ]}
      />

      {/* Amount display */}
      <div className="flex items-end justify-between gap-3 rounded-3xl bg-surface-2/60 px-5 py-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          {selected ? (
            <>
              <IconTile name={selected.icon} color={selected.color} size={28} />
              <span className="font-medium text-fg">{selected.name}</span>
            </>
          ) : (
            <span>{type === 'transfer' ? '帳戶互轉' : '金額'}</span>
          )}
        </div>
        <div className="min-w-0 text-right">
          <AnimatePresence>
            {hasOperator(expr) && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="num truncate text-sm text-muted">
                {expr}
              </motion.div>
            )}
          </AnimatePresence>
          <motion.div
            key={type}
            initial={{ scale: 0.96, opacity: 0.6 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring}
            className="num truncate text-4xl font-extrabold"
            style={{ color: ACCENT[type] }}
          >
            {money(amount, { currency: cur })}
          </motion.div>
          {baseHint && <div className="num text-xs text-muted">{baseHint}</div>}
          {instMode && amount > 0 && (
            <div className="num text-xs font-medium text-muted">
              {periods} 期 × 每期約 {money(Math.round((amount / periods) * 100) / 100, { currency: cur })}
            </div>
          )}
        </div>
      </div>

      {/* Category grid */}
      {type !== 'transfer' && (
        <div>
          <div className="grid grid-cols-5 gap-x-1 gap-y-3">
            {parents.map((c, i) => (
              <CategoryCell
                key={c.id}
                c={c}
                i={i}
                active={activeParentId === c.id}
                onClick={() => setCategoryId(c.id)}
              />
            ))}
          </div>
          <AnimatePresence initial={false}>
            {activeParentId && children(activeParentId).length > 0 && (
              <motion.div
                key={activeParentId}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {children(activeParentId).map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setCategoryId(categoryId === c.id ? activeParentId : c.id)}
                      className={cn(
                        'h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-all',
                        categoryId === c.id ? 'border-transparent text-white' : 'border-border text-muted hover:text-fg',
                      )}
                      style={categoryId === c.id ? { background: c.color } : undefined}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Accounts */}
      <div className={cn('flex items-center gap-2', type === 'transfer' && 'flex-col sm:flex-row')}>
        <AccountChips label={type === 'transfer' ? '轉出' : '帳戶'} value={accountId} onChange={setAccountId} />
        {type === 'transfer' && (
          <>
            <ArrowRight className="size-4 shrink-0 rotate-90 text-muted sm:rotate-0" />
            <AccountChips label="轉入" value={toAccountId} onChange={setToAccountId} exclude={accountId} />
          </>
        )}
      </div>

      {crossCurrency && (
        <motion.label initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 rounded-2xl bg-transfer/10 px-4 py-2.5">
          <span className="shrink-0 text-sm font-medium">轉入金額</span>
          <span className="text-sm text-muted">{symbolOf(toAcc!.currency)}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={toAmountStr}
            placeholder={String(autoToAmount)}
            onChange={(e) => setToAmountStr(e.target.value)}
            className="num h-9 min-w-0 flex-1 rounded-xl bg-surface px-3 text-right font-semibold outline-none"
          />
          <span className="shrink-0 text-xs text-muted">{toAcc!.currency}</span>
        </motion.label>
      )}

      <DateTimePicker value={date} onChange={setDate} />

      {type === 'expense' && !editing && (
        <div className="rounded-2xl bg-surface-2/60 px-4 py-2.5">
          <label className="flex items-center gap-3">
            <Layers className="size-4 text-primary" />
            <span className="flex-1 text-sm font-medium">分期付款</span>
            <Toggle on={installment} onChange={setInstallment} />
          </label>
          <AnimatePresence initial={false}>
            {installment && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {[3, 6, 12, 18, 24, 36].map((n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={() => setPeriods(n)}
                      className={cn('h-8 rounded-full px-3 text-[13px] font-semibold transition-colors', periods === n ? 'bg-primary text-white dark:text-[#06231a]' : 'bg-surface text-muted')}
                    >
                      {n} 期
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">從所選日期起每月自動產生一期支出；未到期的期數不會計入目前餘額。</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Note + tags */}
      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="備註（選填）"
          maxLength={200}
          className="h-11 min-w-0 flex-1 rounded-2xl bg-surface-2/60 px-4 text-[15px] outline-none placeholder:text-muted focus:ring-2 focus:ring-primary/30"
        />
        <Button type="button" variant={showTags || tagIds.length ? 'soft' : 'outline'} size="icon" className="size-11" onClick={() => setShowTags((s) => !s)} aria-label="標籤">
          <Hash className="size-4" />
        </Button>
        <Button type="button" variant="outline" size="icon" className="size-11" onClick={saveAsTemplate} loading={saveTpl.isPending} aria-label="存為模板" title="存為模板">
          <BookmarkPlus className="size-4" />
        </Button>
        {!instMode && (
          <label className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-2xl border border-border bg-surface transition-colors hover:bg-surface-2" aria-label="加入收據照片" title="收據照片">
            <Camera className="size-4" />
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>

      {/* Receipt photos */}
      <AnimatePresence initial={false}>
        {!instMode && (keptPhotos.length > 0 || newPhotos.length > 0) && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {[...keptPhotos.map((id) => ({ key: `a${id}`, url: `/api/attachments/${id}`, remove: () => setKeptPhotos((k) => k.filter((x) => x !== id)) })),
                ...newPhotos.map((p) => ({ key: p.url, url: p.url, remove: () => setNewPhotos((n) => n.filter((x) => x.url !== p.url)) }))].map((ph) => (
                <motion.div key={ph.key} layout initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative shrink-0">
                  <button type="button" onClick={() => setViewer(ph.url)} className="block size-20 overflow-hidden rounded-2xl border border-border">
                    <img src={ph.url} alt="收據" className="size-full object-cover" loading="lazy" />
                  </button>
                  <button type="button" onClick={ph.remove} className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-fg text-bg shadow" aria-label="移除照片">
                    <X className="size-3.5" />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {viewer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setViewer(null)}
            className="fixed inset-0 z-[70] grid place-items-center bg-black/85 p-4"
          >
            <motion.img initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} src={viewer} alt="收據" className="max-h-full max-w-full rounded-2xl object-contain" />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {showTags && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => setTagIds((ids) => (on ? ids.filter((x) => x !== t.id) : [...ids, t.id]))}
                    className={cn('h-8 rounded-full px-3 text-[13px] font-medium transition-colors', on ? 'bg-primary text-white dark:text-[#06231a]' : 'bg-surface-2 text-muted')}
                  >
                    #{t.name}
                  </button>
                );
              })}
              <form
                className="flex h-8 items-center rounded-full border border-dashed border-border pl-3 pr-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  addTag();
                }}
              >
                <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="新標籤" maxLength={20} className="w-20 bg-transparent text-[13px] outline-none" />
                <button type="submit" className="grid size-6 place-items-center rounded-full text-primary" aria-label="新增標籤">
                  <Plus className="size-4" />
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Keypad
        expr={expr}
        setExpr={setExpr}
        onSubmit={submit}
        submitLabel={editing ? '更新' : instMode ? '分期' : '完成'}
        accent={ACCENT[type]}
        loading={save.isPending || createInst.isPending || uploading}
      />

      {editing && (
        <Button variant="danger" className="w-full" onClick={onDelete}>
          <Trash2 className="size-4" /> 刪除這筆紀錄
        </Button>
      )}
    </div>
  );
}

export function CategoryCell({ c, i, active, onClick }: { c: Category; i: number; active: boolean; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.02, ...spring }}
      whileTap={{ scale: 0.9 }}
      aria-label={c.name}
      aria-pressed={active}
      className="flex flex-col items-center gap-1.5"
    >
      <span className="relative">
        <IconTile name={c.icon} color={c.color} size={48} className={cn('transition-transform', active && 'scale-105')} />
        {active && (
          <motion.span layoutId="cat-ring" transition={spring} className="absolute -inset-[3px] rounded-[18px] border-2" style={{ borderColor: c.color }} />
        )}
      </span>
      <span className={cn('max-w-full truncate text-xs', active ? 'font-semibold text-fg' : 'text-muted')}>{c.name}</span>
    </motion.button>
  );
}

export function AccountChips({ label, value, onChange, exclude }: { label: string; value: number | null; onChange: (id: number) => void; exclude?: number | null }) {
  const { accs } = useLookups();
  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs font-medium text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto no-scrollbar">
        {accs
          .filter((a) => a.id !== exclude)
          .map((a) => (
            <button
              type="button"
              key={a.id}
              onClick={() => onChange(a.id)}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-full border pl-1.5 pr-3 text-sm font-medium transition-colors',
                value === a.id ? 'border-primary bg-primary-soft text-fg' : 'border-border text-muted hover:text-fg',
              )}
            >
              <IconTile name={a.icon} color={a.color} size={24} className="rounded-full" />
              {a.name}
            </button>
          ))}
      </div>
    </div>
  );
}
