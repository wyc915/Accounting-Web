import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, ShieldCheck } from 'lucide-react';
import type { User } from '@ledger/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/format';
import { useUI } from '@/stores/ui';
import { BackLink } from '@/components/BackLink';
import { Button, Field, Input, PageHeader, Segmented, Sheet } from '@/components/ui';

const MINUTES = [1, 5, 15, 30, 60] as const;

export function SecurityPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [sheet, setSheet] = useState<'set' | 'disable' | null>(null);
  if (!me) return null;

  const setMinutes = async (m: number) => {
    try {
      const u = await api.put<User>('/auth/lock-settings', { lockMinutes: m });
      qc.setQueryData(['me'], u);
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };
  const lockNow = async () => {
    await api.post('/auth/lock');
    qc.setQueryData<User>(['me'], (m) => (m ? { ...m, locked: true } : m));
  };

  return (
    <div className="space-y-5">
      <BackLink to="/settings" label="更多" />
      <PageHeader title="安全性" />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card flex items-center gap-4 p-5">
        <span className={cn('grid size-12 place-items-center rounded-2xl', me.pinEnabled ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted')}>
          {me.pinEnabled ? <ShieldCheck className="size-6" /> : <LockOpen className="size-6" />}
        </span>
        <div className="flex-1">
          <p className="font-bold">PIN 碼鎖 {me.pinEnabled ? '已啟用' : '未啟用'}</p>
          <p className="text-sm text-muted">{me.pinEnabled ? `閒置 ${me.lockMinutes} 分鐘後自動鎖定` : '開啟 App 或閒置一段時間後需輸入 PIN'}</p>
        </div>
      </motion.div>

      {me.pinEnabled ? (
        <>
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">自動鎖定</h2>
            <Segmented
              layoutId="lock-min"
              size="sm"
              value={String(me.lockMinutes)}
              onChange={(v) => setMinutes(Number(v))}
              options={MINUTES.map((m) => ({ value: String(m), label: m === 60 ? '1 小時' : `${m} 分` }))}
            />
          </section>
          <div className="grid gap-3 sm:grid-cols-3">
            <Button variant="soft" onClick={lockNow}><Lock className="size-4" /> 立即鎖定</Button>
            <Button variant="outline" onClick={() => setSheet('set')}>變更 PIN</Button>
            <Button variant="danger" onClick={() => setSheet('disable')}>關閉 PIN 鎖</Button>
          </div>
        </>
      ) : (
        <Button className="h-12 w-full" onClick={() => setSheet('set')}><Lock className="size-4" /> 設定 PIN 碼</Button>
      )}

      <p className="px-1 text-xs leading-relaxed text-muted">
        PIN 鎖由伺服器強制執行：鎖定期間所有資料 API 都會拒絕存取，不只是畫面遮蔽。忘記 PIN 時可登出並以密碼重新登入，再到這裡關閉或重設。
      </p>

      <PinSheet mode={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

function PinSheet({ mode, onClose }: { mode: 'set' | 'disable' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [f, setF] = useState({ pin: '', confirm: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState(mode);
  if (key !== mode) {
    setKey(mode);
    setF({ pin: '', confirm: '', password: '' });
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'set') {
      if (!/^\d{4,6}$/.test(f.pin)) return toast({ message: 'PIN 需為 4–6 位數字', tone: 'error' });
      if (f.pin !== f.confirm) return toast({ message: '兩次輸入的 PIN 不一致', tone: 'error' });
    }
    setLoading(true);
    try {
      const u =
        mode === 'set'
          ? await api.post<User>('/auth/pin', { pin: f.pin, password: f.password })
          : await api.del<User>('/auth/pin', { password: f.password });
      qc.setQueryData(['me'], u);
      toast({ message: mode === 'set' ? 'PIN 已設定' : 'PIN 鎖已關閉' });
      onClose();
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  return (
    <Sheet open={!!mode} onClose={onClose} title={mode === 'disable' ? '關閉 PIN 鎖' : '設定 PIN 碼'}>
      <form onSubmit={submit} className="space-y-4">
        {mode === 'set' && (
          <>
            <Field label="新 PIN（4–6 位數字）">
              <Input type="password" inputMode="numeric" autoComplete="off" value={f.pin} onChange={(e) => setF({ ...f, pin: digits(e.target.value) })} className="text-center text-2xl tracking-[0.5em]" autoFocus />
            </Field>
            <Field label="再輸入一次">
              <Input type="password" inputMode="numeric" autoComplete="off" value={f.confirm} onChange={(e) => setF({ ...f, confirm: digits(e.target.value) })} className="text-center text-2xl tracking-[0.5em]" />
            </Field>
          </>
        )}
        <Field label="登入密碼（確認身分）">
          <Input type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Button type="submit" variant={mode === 'disable' ? 'danger' : 'primary'} className="h-12 w-full" loading={loading}>
          {mode === 'disable' ? '關閉 PIN 鎖' : '儲存 PIN'}
        </Button>
      </form>
    </Sheet>
  );
}
