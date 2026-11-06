import { useState } from 'react';
import { motion } from 'framer-motion';
import { addMonths, parseISO } from 'date-fns';
import { CalendarClock, Layers, Plus } from 'lucide-react';
import type { InstallmentPlan } from '@ledger/shared';
import { useDeleteInstallment, useInstallments, useLookups } from '@/lib/queries';
import { fmt, money } from '@/lib/format';
import { IconTile } from '@/lib/icons';
import { useUI } from '@/stores/ui';
import { Button, Empty, PageHeader, Sheet } from '@/components/ui';
import { BackLink } from '@/components/BackLink';

export function InstallmentsPage() {
  const { data: plans = [], isLoading } = useInstallments();
  const { accMap, catMap } = useLookups();
  const openEditor = useUI((s) => s.openEditor);
  const [open, setOpen] = useState<InstallmentPlan | null>(null);

  const active = plans.filter((p) => p.posted < p.periods);
  const remaining = active.reduce((s, p) => s + (p.total - p.postedAmount), 0);
  const monthly = active.reduce((s, p) => s + p.total / p.periods, 0);

  return (
    <div className="space-y-5">
      <BackLink to="/accounts" label="帳戶" />
      <PageHeader title="分期付款" right={<Button size="sm" onClick={() => openEditor(undefined, { installment: true })}><Plus className="size-4" /> 新增分期</Button>} />

      {plans.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4">
            <p className="text-xs text-muted">未繳分期總額</p>
            <p className="num text-xl font-extrabold">{money(remaining)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-muted">每月分期負擔（約）</p>
            <p className="num text-xl font-extrabold">{money(Math.round(monthly))}</p>
          </div>
        </div>
      )}

      {!isLoading && plans.length === 0 ? (
        <div className="card">
          <Empty icon={<Layers className="size-7" />} title="沒有分期" hint="在記一筆時開啟「分期付款」，系統會自動產生每期紀錄" action={<Button onClick={() => openEditor(undefined, { installment: true })}><Plus className="size-4" /> 新增分期</Button>} />
        </div>
      ) : (
        <ul className="space-y-3">
          {plans.map((p, i) => {
            const c = p.categoryId ? catMap.get(p.categoryId) : undefined;
            const a = accMap.get(p.accountId);
            const done = p.posted >= p.periods;
            const next = done ? null : addMonths(parseISO(p.startDate), p.posted);
            return (
              <motion.li key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <button onClick={() => setOpen(p)} className="card w-full p-4 text-left">
                  <div className="flex items-center gap-3">
                    <IconTile name={c?.icon ?? 'credit-card'} color={c?.color ?? '#a78bfa'} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{p.name}</p>
                      <p className="truncate text-[13px] text-muted">{a?.name} · {money(p.total / p.periods, { currency: a?.currency })}/期 × {p.periods}</p>
                    </div>
                    <div className="text-right">
                      <p className="num font-bold">{money(p.total, { currency: a?.currency })}</p>
                      <p className="text-xs text-muted">{done ? '已繳清' : `${p.posted}/${p.periods} 期`}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-1">
                    {Array.from({ length: p.periods }).map((_, k) => (
                      <motion.span
                        key={k}
                        initial={{ scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{ delay: 0.1 + k * 0.02 }}
                        className="h-2 flex-1 rounded-full"
                        style={{ background: k < p.posted ? (c?.color ?? 'var(--primary)') : 'var(--surface-2)' }}
                      />
                    ))}
                  </div>
                  {next && (
                    <p className="mt-2 flex items-center gap-1 text-xs text-muted">
                      <CalendarClock className="size-3.5" /> 下一期 {fmt(next, 'yyyy/M/d')}
                    </p>
                  )}
                </button>
              </motion.li>
            );
          })}
        </ul>
      )}

      <PlanSheet plan={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function PlanSheet({ plan, onClose }: { plan: InstallmentPlan | null; onClose: () => void }) {
  const del = useDeleteInstallment();
  const toast = useUI((s) => s.toast);
  const remove = async (mode: 'future' | 'all') => {
    try {
      const r = await del.mutateAsync({ id: plan!.id, mode });
      toast({ message: mode === 'all' ? '已刪除整筆分期' : `已取消剩餘 ${r.removed} 期` });
      onClose();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };
  return (
    <Sheet open={!!plan} onClose={onClose} title={plan?.name}>
      {plan && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            共 {plan.periods} 期，已入帳 {plan.posted} 期（{money(plan.postedAmount)}），開始於 {fmt(parseISO(plan.startDate), 'yyyy/M/d')}。
            每一期都是一筆獨立的支出紀錄，會在該月日期自動計入帳戶餘額。
          </p>
          <Button variant="outline" className="w-full" disabled={plan.posted >= plan.periods} loading={del.isPending} onClick={() => remove('future')}>
            提前結清／取消剩餘期數（保留已入帳）
          </Button>
          <Button variant="danger" className="w-full" loading={del.isPending} onClick={() => remove('all')}>
            刪除整筆分期（含已入帳紀錄）
          </Button>
        </div>
      )}
    </Sheet>
  );
}
