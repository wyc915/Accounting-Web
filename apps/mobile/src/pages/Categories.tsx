import { useEffect, useState } from 'react';
import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion';
import { ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { categoryInput, type Category, type CategoryType } from '@ledger/shared';
import { useCategories, useDeleteCategory, useReorder, useSaveCategory } from '@/lib/queries';
import { cn } from '@/lib/format';
import { IconTile } from '@/lib/icons';
import { useUI } from '@/stores/ui';
import { Button, Confirm, Field, Input, PageHeader, Segmented, Sheet } from '@/components/ui';
import { ColorPicker, IconPicker } from '@/components/Pickers';

type Editing = { cat?: Category; parent?: Category; type: CategoryType } | null;

export function CategoriesPage() {
  const { data: cats = [] } = useCategories();
  const reorder = useReorder('categories');
  const [type, setType] = useState<CategoryType>('expense');
  const [order, setOrder] = useState<Category[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  useEffect(() => setOrder(cats.filter((c) => c.type === type && c.parentId == null)), [cats, type]);
  const childrenOf = (id: number) => cats.filter((c) => c.parentId === id);

  return (
    <div>
      <PageHeader
        title="類別"
        right={
          <Button size="sm" onClick={() => setEditing({ type })}>
            <Plus className="size-4" /> 新增
          </Button>
        }
      />
      <Segmented
        layoutId="cat-type"
        value={type}
        onChange={setType}
        options={[
          { value: 'expense', label: '支出類別', activeClass: 'text-expense' },
          { value: 'income', label: '收入類別', activeClass: 'text-income' },
        ]}
      />
      <p className="mb-2 mt-5 px-1 text-xs text-muted">點擊展開子類別 · 拖曳把手調整排序</p>
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="space-y-2">
        {order.map((c) => (
          <CategoryRow
            key={c.id}
            c={c}
            kids={childrenOf(c.id)}
            open={expanded === c.id}
            onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
            onEdit={(cat) => setEditing({ cat, type })}
            onAddChild={() => setEditing({ parent: c, type })}
            onDrop={() => reorder.mutate(order.map((o) => o.id))}
          />
        ))}
      </Reorder.Group>
      <CategorySheet editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function CategoryRow({
  c, kids, open, onToggle, onEdit, onAddChild, onDrop,
}: {
  c: Category;
  kids: Category[];
  open: boolean;
  onToggle: () => void;
  onEdit: (c: Category) => void;
  onAddChild: () => void;
  onDrop: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={c}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDrop}
      className="card relative overflow-hidden"
      whileDrag={{ scale: 1.02, boxShadow: '0 16px 40px -12px rgb(0 0 0 / 0.3)', zIndex: 10 }}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <button className="cursor-grab touch-none p-1 text-muted active:cursor-grabbing" onPointerDown={(e) => controls.start(e)} aria-label="拖曳排序">
          <GripVertical className="size-4" />
        </button>
        <button onClick={() => onEdit(c)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <IconTile name={c.icon} color={c.color} size={42} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{c.name}</p>
            <p className="text-xs text-muted">{kids.length ? `${kids.length} 個子類別` : '無子類別'}</p>
          </div>
        </button>
        <button onClick={onToggle} className="grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="展開">
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 30 }}>
            <ChevronDown className="size-5 text-muted" />
          </motion.span>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
              {kids.map((k, i) => (
                <motion.button
                  key={k.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => onEdit(k)}
                  className="flex h-9 items-center gap-1.5 rounded-full bg-surface-2 pl-1.5 pr-3 text-sm font-medium hover:brightness-95"
                >
                  <IconTile name={k.icon} color={k.color} size={24} className="rounded-full" />
                  {k.name}
                </motion.button>
              ))}
              <button onClick={onAddChild} className="flex h-9 items-center gap-1 rounded-full border border-dashed border-border px-3 text-sm text-muted hover:text-fg">
                <Plus className="size-4" /> 子類別
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}

function CategorySheet({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const save = useSaveCategory();
  const del = useDeleteCategory();
  const toast = useUI((s) => s.toast);
  const [confirm, setConfirm] = useState(false);
  const [f, setF] = useState({ name: '', icon: 'tag', color: '#10b981' });
  const cat = editing?.cat;
  const isChild = !!(editing?.parent || cat?.parentId);

  useEffect(() => {
    if (!editing) return;
    setF(cat ? { name: cat.name, icon: cat.icon, color: cat.color } : { name: '', icon: 'tag', color: editing.parent?.color ?? '#10b981' });
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = categoryInput.safeParse({
      ...f,
      type: cat?.type ?? editing!.type,
      parentId: cat ? cat.parentId : (editing!.parent?.id ?? null),
    });
    if (!parsed.success) return toast({ message: parsed.error.issues[0].message, tone: 'error' });
    try {
      await save.mutateAsync({ id: cat?.id, data: parsed.data });
      toast({ message: cat ? '類別已更新' : '類別已新增' });
      onClose();
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    }
  };

  const remove = async () => {
    await del.mutateAsync(cat!.id);
    toast({ message: '類別已刪除' });
    setConfirm(false);
    onClose();
  };

  const title = cat ? '編輯類別' : editing?.parent ? `新增「${editing.parent.name}」子類別` : '新增類別';

  return (
    <>
      <Sheet open={!!editing} onClose={onClose} title={title}>
        <form onSubmit={submit} className="space-y-5">
          <div className="flex items-center gap-4">
            <motion.div key={f.icon + f.color} initial={{ scale: 0.8, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
              <IconTile name={f.icon} color={f.color} size={60} />
            </motion.div>
            <div className="flex-1">
              <Field label="名稱">
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="類別名稱" maxLength={20} autoFocus={!cat} />
              </Field>
            </div>
          </div>
          <Field label="顏色">
            <ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} />
          </Field>
          <Field label="圖示">
            <IconPicker value={f.icon} color={f.color} onChange={(icon) => setF({ ...f, icon })} />
          </Field>
          <div className="flex gap-3">
            {cat && (
              <Button type="button" variant="danger" size="icon" className="size-12 shrink-0" onClick={() => setConfirm(true)} aria-label="刪除類別">
                <Trash2 className="size-5" />
              </Button>
            )}
            <Button type="submit" size="lg" className={cn('h-12 flex-1')} loading={save.isPending}>
              儲存
            </Button>
          </div>
        </form>
      </Sheet>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="刪除類別？"
        message={`刪除「${cat?.name}」${isChild ? '' : '會一併刪除其子類別，'}相關紀錄將變為「未分類」，不會被刪除。`}
        confirmText="刪除"
        onConfirm={remove}
        loading={del.isPending}
      />
    </>
  );
}
