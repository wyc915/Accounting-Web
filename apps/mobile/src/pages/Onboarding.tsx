import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, ShieldCheck, Smartphone, WifiOff } from 'lucide-react';
import type { Currency, User } from '@ledger/shared';
import { api } from '@/lib/api';
import { isEncrypted } from '@ledger/core';
import { useUI } from '@/stores/ui';
import { Button, Field, Input, Sheet } from '@/components/ui';
import { CurrencySelect } from './Currency';

/** First launch: name + base currency (or restore a backup) */
export function OnboardingPage() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('TWD');
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{ text: string; name: string } | null>(null);
  const [password, setPassword] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const me = await api.post<User>('/app/onboard', { name: name.trim() || '我', baseCurrency: currency });
      qc.setQueryData(['me'], me);
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!restore) return;
    setBusy(true);
    try {
      await api.post('/backup/restore', { text: restore.text, password: password || undefined });
      await qc.invalidateQueries();
      toast({ message: '已從備份還原' });
    } catch (err) {
      toast({ message: (err as Error).message, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const features = [
    { icon: WifiOff, text: '完全離線，資料只存在這支手機' },
    { icon: ShieldCheck, text: '資料庫加密，可設定 PIN 與指紋／臉部解鎖' },
    { icon: Smartphone, text: '沒有帳號、不需註冊、不收集任何資料' },
  ];

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute -left-32 -top-32 size-[420px] rounded-full bg-emerald-300/40 blur-3xl dark:bg-emerald-500/15" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 size-[460px] rounded-full bg-teal-300/40 blur-3xl dark:bg-teal-500/15" />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="relative w-full max-w-sm">
        <div className="mb-6 text-center">
          <motion.img
            src="/icon.svg"
            alt=""
            className="mx-auto mb-4 size-20"
            initial={{ rotate: -12, scale: 0.8 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}
          />
          <h1 className="text-2xl font-extrabold tracking-tight">歡迎使用點滴記帳</h1>
          <p className="mt-1 text-sm text-muted">一點一滴，看見你的生活</p>
        </div>

        <ul className="mb-5 space-y-2">
          {features.map((f, i) => (
            <motion.li key={f.text} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.08 }} className="flex items-center gap-3 text-sm">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <f.icon className="size-4" />
              </span>
              {f.text}
            </motion.li>
          ))}
        </ul>

        <form onSubmit={start} className="card space-y-4 bg-surface/85 p-5 backdrop-blur-xl">
          <Field label="怎麼稱呼你？">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="你的暱稱" maxLength={40} />
          </Field>
          <Field label="主要幣別">
            <CurrencySelect value={currency} onChange={setCurrency} />
          </Field>
          <Button type="submit" size="lg" className="h-12 w-full" loading={busy}>
            開始使用
          </Button>
        </form>

        <input
          ref={fileRef}
          type="file"
          accept=".json,.diandi,application/json,application/octet-stream"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setRestore({ text: await f.text(), name: f.name });
          }}
        />
        <button onClick={() => fileRef.current?.click()} className="mx-auto mt-5 flex items-center gap-1.5 text-sm font-medium text-primary">
          <ArchiveRestore className="size-4" /> 從備份檔還原（含網頁版備份）
        </button>
      </motion.div>

      <Sheet open={!!restore} onClose={() => setRestore(null)} title="從備份還原">
        <div className="space-y-4">
          <p className="text-sm text-muted">檔案：{restore?.name}</p>
          {restore && isEncrypted(restore.text) && (
            <Field label="備份密碼">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
          )}
          <Button className="h-12 w-full" loading={busy} onClick={doRestore}>
            開始還原
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
