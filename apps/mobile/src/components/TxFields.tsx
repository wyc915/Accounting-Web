import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import type { TxType } from '@ledger/shared';
import { useLookups } from '@/lib/queries';
import { cn } from '@/lib/format';
import { Field, Input, Segmented } from './ui';
import { AccountChips, CategoryCell } from './TransactionEditor';

export type DraftFields = {
  type: TxType;
  amount: string;
  accountId: number | null;
  toAccountId: number | null;
  categoryId: number | null;
  note: string;
};

/** Type + amount + category + account(s) + note — used by recurring rules and templates */
export function TxFields({ v, set, amountOptional }: { v: DraftFields; set: (p: Partial<DraftFields>) => void; amountOptional?: boolean }) {
  const { cats } = useLookups();
  const parents = cats.filter((c) => c.type === v.type && c.parentId == null);
  const selected = cats.find((c) => c.id === v.categoryId);
  const activeParent = selected ? (selected.parentId ?? selected.id) : null;
  const kids = activeParent ? cats.filter((c) => c.parentId === activeParent) : [];

  return (
    <div className="space-y-5">
      <Segmented
        layoutId="draft-type"
        value={v.type}
        onChange={(type) => set({ type, categoryId: null })}
        options={[
          { value: 'expense', label: '支出', activeClass: 'text-expense' },
          { value: 'income', label: '收入', activeClass: 'text-income' },
          { value: 'transfer', label: '轉帳', activeClass: 'text-transfer' },
        ]}
      />
      <Field label={amountOptional ? '金額（留空則每次使用時輸入）' : '金額'}>
        <Input type="number" inputMode="decimal" min={0} step="0.01" value={v.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="0" className="text-lg font-bold" />
      </Field>
      {v.type !== 'transfer' && (
        <div>
          <p className="mb-2 text-[13px] font-medium text-muted">類別</p>
          <div className="grid grid-cols-5 gap-x-1 gap-y-3">
            {parents.map((c, i) => (
              <CategoryCell key={c.id} c={c} i={i} active={activeParent === c.id} onClick={() => set({ categoryId: c.id })} />
            ))}
          </div>
          <AnimatePresence initial={false}>
            {kids.length > 0 && (
              <motion.div key={activeParent} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {kids.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => set({ categoryId: v.categoryId === c.id ? activeParent : c.id })}
                      className={cn('h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-all', v.categoryId === c.id ? 'border-transparent text-white' : 'border-border text-muted hover:text-fg')}
                      style={v.categoryId === c.id ? { background: c.color } : undefined}
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
      <div className={cn('flex items-center gap-2', v.type === 'transfer' && 'flex-col sm:flex-row')}>
        <AccountChips label={v.type === 'transfer' ? '轉出' : '帳戶'} value={v.accountId} onChange={(accountId) => set({ accountId })} />
        {v.type === 'transfer' && (
          <>
            <ArrowRight className="size-4 shrink-0 rotate-90 text-muted sm:rotate-0" />
            <AccountChips label="轉入" value={v.toAccountId} onChange={(toAccountId) => set({ toAccountId })} exclude={v.accountId} />
          </>
        )}
      </div>
      <Field label="備註">
        <Input value={v.note} onChange={(e) => set({ note: e.target.value })} maxLength={200} placeholder="選填" />
      </Field>
    </div>
  );
}

export const draftToPayload = (v: DraftFields) => ({
  type: v.type,
  amount: v.amount === '' ? null : Number(v.amount),
  accountId: v.accountId,
  toAccountId: v.type === 'transfer' ? v.toAccountId : null,
  categoryId: v.type === 'transfer' ? null : v.categoryId,
  note: v.note.trim(),
});
