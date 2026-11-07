import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import type { User } from '@ledger/shared';
import { api } from '@/lib/api';
import { biometricInfo, biometricUnlock, type BioInfo } from '@/lib/biometric';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/format';
import { useUI } from '@/stores/ui';
import { BackLink } from '@/components/BackLink';
import { Button, Field, Input, PageHeader, Segmented, Sheet } from '@/components/ui';
import { Toggle } from './Accounts';

const MINUTES = [1, 5, 15, 30, 60] as const;

export function SecurityPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const { toast, setLocked } = useUI();
  const [sheet, setSheet] = useState<'set' | 'change' | 'disable' | null>(null);
  const [bio, setBio] = useState<BioInfo>({ available: false, label: '生物辨識' });
  useEffect(() => {
    biometricInfo().then(setBio);
  }, []);
  if (!me) return null;

  const save = (u: User) => qc.setQueryData(['me'], u);
  const setMinutes = async (m: number) => {
    try {
      save(await api.put<User>('/auth/lock-settings', { lockMinutes: m }));
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };
  const toggleBio = async (on: boolean) => {
    if (on && !(await biometricUnlock(`啟用${bio.label}`))) return toast({ message: `${bio.label}驗證未通過`, tone: 'error' });
    try {
      save(await api.put<User>('/app/biometric', { enabled: on }));
      toast({ message: on ? `已啟用${bio.label}解鎖` : `已關閉${bio.label}解鎖` });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
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
          <p className="font-bold">App 鎖 {me.pinEnabled ? '已啟用' : '未啟用'}</p>
          <p className="text-sm text-muted">{me.pinEnabled ? `切到背景 ${me.lockMinutes} 分鐘後需重新解鎖` : '開啟 App 時需輸入 PIN'}</p>
        </div>
      </motion.div>

      {me.pinEnabled ? (
        <>
          <section className="card divide-y divide-border overflow-hidden">
            <label className={cn('flex items-center gap-3 px-5 py-4', !bio.available && 'opacity-50')}>
              <Fingerprint className="size-5 text-primary" />
              <div className="flex-1">
                <p className="font-medium">{bio.label}解鎖</p>
                <p className="text-xs text-muted">{bio.available ? '可隨時改用 PIN 解鎖' : '此裝置未設定指紋或臉部辨識'}</p>
              </div>
              <Toggle on={!!me.biometric && bio.available} onChange={(v) => bio.available && toggleBio(v)} />
            </label>
            <div className="px-5 py-4">
              <p className="mb-3 font-medium">切到背景多久後鎖定</p>
              <Segmented
                layoutId="lock-min"
                size="sm"
                value={String(me.lockMinutes)}
                onChange={(v) => setMinutes(Number(v))}
                options={MINUTES.map((m) => ({ value: String(m), label: m === 60 ? '1 小時' : `${m} 分` }))}
              />
            </div>
          </section>
          <div className="grid gap-3 sm:grid-cols-3">
            <Button variant="soft" onClick={() => setLocked(true)}>
              <Lock className="size-4" /> 立即鎖定
            </Button>
            <Button variant="outline" onClick={() => setSheet('change')}>變更 PIN</Button>
            <Button variant="danger" onClick={() => setSheet('disable')}>關閉 App 鎖</Button>
          </div>
        </>
      ) : (
        <Button className="h-12 w-full" onClick={() => setSheet('set')}>
          <Lock className="size-4" /> 設定 PIN 碼
        </Button>
      )}

      <p className="px-1 text-xs leading-relaxed text-muted">
        資料庫以 SQLCipher 加密，金鑰由 Android Keystore 保管；PIN 以 PBKDF2 雜湊儲存，連續錯 5 次會鎖定 5 分鐘。PIN 無法找回，請牢記並定期匯出加密備份。
      </p>

      <PinSheet mode={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

function PinSheet({ mode, onClose }: { mode: 'set' | 'change' | 'disable' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [f, setF] = useState({ current: '', pin: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState(mode);
  if (key !== mode) {
    setKey(mode);
    setF({ current: '', pin: '', confirm: '' });
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode !== 'disable') {
      if (!/^\d{4,6}$/.test(f.pin)) return toast({ message: 'PIN 需為 4–6 位數字', tone: 'error' });
      if (f.pin !== f.confirm) return toast({ message: '兩次輸入的 PIN 不一致', tone: 'error' });
    }
    setLoading(true);
    try {
      const u =
        mode === 'disable'
          ? await api.del<User>('/auth/pin', { pin: f.current })
          : await api.post<User>('/auth/pin', { pin: f.pin, current: mode === 'change' ? f.current : undefined });
      qc.setQueryData(['me'], u);
      toast({ message: mode === 'disable' ? 'App 鎖已關閉' : 'PIN 已設定' });
      onClose();
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  const pinInput = (label: string, k: keyof typeof f, autoFocus = false) => (
    <Field label={label}>
      <Input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={f[k]}
        onChange={(e) => setF({ ...f, [k]: digits(e.target.value) })}
        className="text-center text-2xl tracking-[0.5em]"
        autoFocus={autoFocus}
      />
    </Field>
  );
  return (
    <Sheet open={!!mode} onClose={onClose} title={mode === 'disable' ? '關閉 App 鎖' : mode === 'change' ? '變更 PIN' : '設定 PIN 碼'}>
      <form onSubmit={submit} className="space-y-4">
        {(mode === 'change' || mode === 'disable') && pinInput('目前的 PIN', 'current', true)}
        {mode !== 'disable' && (
          <>
            {pinInput('新 PIN（4–6 位數字）', 'pin', mode === 'set')}
            {pinInput('再輸入一次', 'confirm')}
          </>
        )}
        <Button type="submit" variant={mode === 'disable' ? 'danger' : 'primary'} className="h-12 w-full" loading={loading}>
          {mode === 'disable' ? '關閉 App 鎖' : '儲存 PIN'}
        </Button>
      </form>
    </Sheet>
  );
}
