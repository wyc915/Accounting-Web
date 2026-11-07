import { useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { ArrowLeftRight, Paperclip, Pencil, Trash2 } from 'lucide-react';
import type { Transaction } from '@ledger/shared';
import { useDeleteTransaction, useLookups, useRestoreTransaction } from '@/lib/queries';
import { cn, dayLabel, getBaseCurrency, money } from '@/lib/format';
import { IconTile } from '@/lib/icons';
import { useUI } from '@/stores/ui';

const ACTION_W = 136;

export function TransactionRow({ tx }: { tx: Transaction }) {
  const { catMap, accMap, tagMap } = useLookups();
  const { openEditor, toast } = useUI();
  const del = useDeleteTransaction();
  const restore = useRestoreTransaction();
  const x = useMotionValue(0);
  const actionsOpacity = useTransform(x, [-ACTION_W, -30, 0], [1, 0.6, 0]);
  const dragged = useRef(false);
  const [open, setOpen] = useState(false);

  const cat = tx.categoryId ? catMap.get(tx.categoryId) : undefined;
  const parent = cat?.parentId ? catMap.get(cat.parentId) : undefined;
  const acc = accMap.get(tx.accountId);
  const toAcc = tx.toAccountId ? accMap.get(tx.toAccountId) : undefined;

  const snap = (to: number) => {
    animate(x, to, { type: 'spring', stiffness: 500, damping: 40 });
    setOpen(to !== 0);
  };

  const remove = async () => {
    snap(0);
    await del.mutateAsync(tx.id);
    toast({ message: '已刪除紀錄', action: { label: '復原', onClick: () => restore.mutate(tx.id) }, duration: 6000 });
  };

  const title =
    tx.type === 'transfer'
      ? `${acc?.name ?? '?'} → ${toAcc?.name ?? '?'}`
      : cat
        ? parent
          ? `${parent.name} · ${cat.name}`
          : cat.name
        : '未分類';

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.22 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 36 }}
      className="relative overflow-hidden"
    >
      <motion.div style={{ opacity: actionsOpacity }} className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
        <button onClick={() => { snap(0); openEditor(tx); }} className="grid size-12 place-items-center rounded-2xl bg-surface-2 text-fg" aria-label="編輯">
          <Pencil className="size-4.5" />
        </button>
        <button onClick={remove} className="grid size-12 place-items-center rounded-2xl bg-expense text-white" aria-label="刪除">
          <Trash2 className="size-4.5" />
        </button>
      </motion.div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -ACTION_W, right: 0 }}
        dragElastic={{ left: 0.15, right: 0 }}
        style={{ x }}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={(_, i) => {
          snap(i.offset.x < -50 || i.velocity.x < -400 ? -ACTION_W : 0);
          setTimeout(() => (dragged.current = false), 0);
        }}
        onClick={() => {
          if (dragged.current) return;
          if (open) return snap(0);
          openEditor(tx);
        }}
        className="relative flex cursor-pointer items-center gap-3 bg-surface px-4 py-3 transition-colors hover:bg-surface-2/50"
      >
        {tx.type === 'transfer' ? (
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-transfer/12 text-transfer">
            <ArrowLeftRight className="size-5" />
          </span>
        ) : (
          <IconTile name={cat?.icon ?? 'ellipsis'} color={cat?.color ?? '#94a3b8'} size={44} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          <p className="flex items-center gap-1.5 truncate text-[13px] text-muted">
            <span>{tx.occurredAt.slice(11, 16)}</span>
            {tx.type !== 'transfer' && acc && <span>· {acc.name}</span>}
            {tx.installmentNo != null && (
              <span className="shrink-0 rounded-md bg-primary-soft px-1.5 text-[11px] font-medium text-primary-strong dark:text-primary">分期</span>
            )}
            {tx.attachmentIds.length > 0 && (
              <span className="flex shrink-0 items-center gap-0.5" aria-label={`${tx.attachmentIds.length} 張收據`}>
                <Paperclip className="size-3" />
                {tx.attachmentIds.length > 1 && tx.attachmentIds.length}
              </span>
            )}
            {tx.note && <span className="truncate">· {tx.note}</span>}
            {tx.tagIds.map((id) => tagMap.get(id)).filter(Boolean).map((t) => (
              <span key={t!.id} className="shrink-0 rounded-md bg-surface-2 px-1.5 text-[11px]">#{t!.name}</span>
            ))}
          </p>
        </div>
        <span className="shrink-0 text-right">
          <span
            className={cn(
              'num block text-[17px] font-bold',
              tx.type === 'expense' ? 'text-fg' : tx.type === 'income' ? 'text-income' : 'text-transfer',
            )}
          >
            {tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : ''}
            {money(tx.amount, { currency: acc?.currency })}
          </span>
          {acc && acc.currency !== getBaseCurrency() && <span className="num block text-[11px] text-muted">≈ {money(tx.baseAmount)}</span>}
          {tx.type === 'transfer' && toAcc && tx.toAmount != null && toAcc.currency !== acc?.currency && (
            <span className="num block text-[11px] text-muted">→ {money(tx.toAmount, { currency: toAcc.currency })}</span>
          )}
        </span>
      </motion.div>
    </motion.li>
  );
}

/** Groups transactions by day with daily totals */
export function GroupedTransactions({ items }: { items: Transaction[] }) {
  const groups = new Map<string, Transaction[]>();
  for (const t of items) {
    const d = t.occurredAt.slice(0, 10);
    groups.set(d, [...(groups.get(d) ?? []), t]);
  }
  return (
    <div className="space-y-4">
      <AnimatePresence initial={false}>
        {[...groups.entries()].map(([day, list]) => {
          const exp = list.filter((t) => t.type === 'expense').reduce((s, t) => s + t.baseAmount, 0);
          const inc = list.filter((t) => t.type === 'income').reduce((s, t) => s + t.baseAmount, 0);
          return (
            <motion.section key={day} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h3 className="text-sm font-semibold">{dayLabel(day)}</h3>
                <span className="num text-xs text-muted">
                  {inc > 0 && <span className="mr-2 text-income">收 {money(inc)}</span>}
                  {exp > 0 && <span>支 {money(exp)}</span>}
                </span>
              </div>
              <ul className="card divide-y divide-border overflow-hidden">
                <AnimatePresence initial={false}>
                  {list.map((t) => (
                    <TransactionRow key={t.id} tx={t} />
                  ))}
                </AnimatePresence>
              </ul>
            </motion.section>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
