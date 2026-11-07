import { useEffect, useState } from 'react';
import { Reorder, motion, useDragControls } from 'framer-motion';
import { ArrowLeftRight, GripVertical, Plus, Trash2, Zap } from 'lucide-react';
import { templateInput, type Template, type Transaction } from '@ledger/shared';
import { api } from '@/lib/api';
import {
  useDeleteTemplate, useDeleteTransaction, useInvalidateLedger, useLookups, useReorderTemplates, useSaveTemplate, useTemplates,
} from '@/lib/queries';
import { money, toLocalDT } from '@/lib/format';
import { IconTile } from '@/lib/icons';
import { checkBudgetAlert } from '@/lib/budgetAlert';
import { useUI } from '@/stores/ui';
import { Button, Confirm, Empty, Field, Input, PageHeader, Sheet } from '@/components/ui';
import { TxFields, draftToPayload, type DraftFields } from '@/components/TxFields';

/** One-tap use: saves immediately when the template is complete, else opens the editor prefilled */
export function useApplyTemplate() {
  const { openEditor, toast } = useUI();
  const inv = useInvalidateLedger();
  const del = useDeleteTransaction();
  const { cats } = useLookups();
  return async (t: Template) => {
    const complete = t.amount != null && t.accountId != null && (t.type === 'transfer' ? t.toAccountId != null : t.categoryId != null);
    if (!complete) return openEditor(undefined, { ...t });
    try {
      const tx = await api.post<Transaction>('/transactions', {
        type: t.type,
        amount: t.amount,
        accountId: t.accountId,
        toAccountId: t.toAccountId,
        categoryId: t.categoryId,
        note: t.note,
        occurredAt: toLocalDT(new Date()),
        tagIds: [],
      });
      await inv();
      toast({ message: `已記下「${t.name}」${money(t.amount!)}`, action: { label: '復原', onClick: () => del.mutate(tx.id) }, duration: 5000 });
      if (t.type === 'expense') checkBudgetAlert(new Date(), t.categoryId, cats);
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };
}

export function TemplateChip({ t, onClick }: { t: Template; onClick: () => void }) {
  const { catMap } = useLookups();
  const c = t.categoryId ? catMap.get(t.categoryId) : undefined;
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className="flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-border bg-surface pl-1.5 pr-3.5 shadow-card"
    >
      {t.type === 'transfer' ? (
        <span className="grid size-9 place-items-center rounded-xl bg-transfer/12 text-transfer"><ArrowLeftRight className="size-4" /></span>
      ) : (
        <IconTile name={c?.icon ?? 'zap'} color={c?.color ?? '#eab308'} size={36} className="rounded-xl" />
      )}
      <span className="text-left leading-tight">
        <span className="block text-sm font-semibold">{t.name}</span>
        <span className="num block text-[11px] text-muted">{t.amount != null ? money(t.amount) : '輸入金額'}</span>
      </span>
    </motion.button>
  );
}

export function TemplatesPage() {
  const { data: templates = [], isLoading } = useTemplates();
  const reorder = useReorderTemplates();
  const apply = useApplyTemplate();
  const del = useDeleteTemplate();
  const toast = useUI((s) => s.toast);
  const [order, setOrder] = useState<Template[]>([]);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Template | null>(null);
  useEffect(() => setOrder(templates), [templates]);

  return (
    <div className="space-y-5">
      <PageHeader title="常用模板" right={<Button size="sm" onClick={() => setEditing('new')}><Plus className="size-4" /> 新增</Button>} />
      <p className="-mt-3 px-1 text-sm text-muted">點擊「使用」一鍵記帳；在記帳畫面按 <b>書籤</b> 圖示也能快速存成模板。</p>

      {!isLoading && templates.length === 0 ? (
        <div className="card">
          <Empty icon={<Zap className="size-7" />} title="還沒有模板" hint="把常記的早餐、咖啡、通勤存起來" action={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> 新增模板</Button>} />
        </div>
      ) : (
        <Reorder.Group axis="y" values={order} onReorder={setOrder} className="card divide-y divide-border overflow-hidden">
          {order.map((t) => (
            <TemplateRow key={t.id} t={t} onEdit={() => setEditing(t)} onUse={() => apply(t)} onDelete={() => setDeleting(t)} onDrop={() => reorder.mutate(order.map((o) => o.id))} />
          ))}
        </Reorder.Group>
      )}
      <TemplateSheet editing={editing} onClose={() => setEditing(null)} />
      <Confirm
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`刪除模板「${deleting?.name ?? ''}」？`}
        confirmText="刪除"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(deleting!.id);
            toast({ message: '模板已刪除' });
          } catch (err) {
            toast({ message: (err as Error).message, tone: 'error' });
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function TemplateRow({ t, onEdit, onUse, onDelete, onDrop }: { t: Template; onEdit: () => void; onUse: () => void; onDelete: () => void; onDrop: () => void }) {
  const controls = useDragControls();
  const { catMap, accMap } = useLookups();
  const c = t.categoryId ? catMap.get(t.categoryId) : undefined;
  return (
    <Reorder.Item value={t} dragListener={false} dragControls={controls} onDragEnd={onDrop} className="relative flex items-center gap-3 bg-surface px-3 py-3" whileDrag={{ scale: 1.02, zIndex: 10, boxShadow: '0 12px 30px -10px rgb(0 0 0 / 0.25)' }}>
      <button className="cursor-grab touch-none p-1 text-muted" onPointerDown={(e) => controls.start(e)} aria-label="拖曳排序"><GripVertical className="size-4" /></button>
      <button onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {t.type === 'transfer' ? (
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-transfer/12 text-transfer"><ArrowLeftRight className="size-5" /></span>
        ) : (
          <IconTile name={c?.icon ?? 'zap'} color={c?.color ?? '#eab308'} size={44} />
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">{t.name}</p>
          <p className="truncate text-[13px] text-muted">
            {t.type === 'expense' ? '支出' : t.type === 'income' ? '收入' : '轉帳'} · {c?.name ?? (t.type === 'transfer' ? '帳戶互轉' : '未選類別')}
            {t.accountId && ` · ${accMap.get(t.accountId)?.name ?? ''}`}
          </p>
        </div>
      </button>
      <span className="num shrink-0 font-bold">{t.amount != null ? money(t.amount) : '—'}</span>
      <Button size="sm" variant="soft" onClick={onUse}>使用</Button>
      <button onClick={onDelete} className="-mr-1 grid size-9 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-expense/10 hover:text-expense active:scale-90" aria-label={`刪除 ${t.name}`}>
        <Trash2 className="size-4" />
      </button>
    </Reorder.Item>
  );
}

function TemplateSheet({ editing, onClose }: { editing: Template | 'new' | null; onClose: () => void }) {
  const save = useSaveTemplate();
  const del = useDeleteTemplate();
  const { accs } = useLookups();
  const toast = useUI((s) => s.toast);
  const tpl = editing && editing !== 'new' ? editing : null;
  const [name, setName] = useState('');
  const [v, setV] = useState<DraftFields>({ type: 'expense', amount: '', accountId: null, toAccountId: null, categoryId: null, note: '' });
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setName(tpl?.name ?? '');
    setV(
      tpl
        ? { type: tpl.type, amount: tpl.amount == null ? '' : String(tpl.amount), accountId: tpl.accountId, toAccountId: tpl.toAccountId, categoryId: tpl.categoryId, note: tpl.note }
        : { type: 'expense', amount: '', accountId: accs[0]?.id ?? null, toAccountId: accs[1]?.id ?? null, categoryId: null, note: '' },
    );
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const parsed = templateInput.safeParse({ name, ...draftToPayload(v) });
    if (!parsed.success) return toast({ message: parsed.error.issues[0].message, tone: 'error' });
    try {
      await save.mutateAsync({ id: tpl?.id, data: parsed.data });
      toast({ message: '模板已儲存' });
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
        title={tpl ? '編輯模板' : '新增模板'}
        footer={
          <div className="flex gap-3">
            {tpl && <Button variant="danger" size="icon" className="size-12 shrink-0" onClick={() => setConfirm(true)} aria-label="刪除"><Trash2 className="size-5" /></Button>}
            <Button className="h-12 flex-1" onClick={submit} loading={save.isPending}>儲存</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field label="模板名稱">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="例如：早餐" />
          </Field>
          <TxFields v={v} set={(p) => setV((s) => ({ ...s, ...p }))} amountOptional />
        </div>
      </Sheet>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="刪除模板？"
        confirmText="刪除"
        loading={del.isPending}
        onConfirm={async () => {
          await del.mutateAsync(tpl!.id);
          setConfirm(false);
          onClose();
          toast({ message: '模板已刪除' });
        }}
      />
    </>
  );
}
