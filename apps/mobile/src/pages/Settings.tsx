import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, ChevronRight, Coins, DatabaseBackup, Goal, KeyRound, Layers, LayoutGrid, LogOut, Monitor, Moon, Repeat, ShieldCheck, Sun,
  Target, UserRound, Wallet, Zap,
} from 'lucide-react';
import type { User } from '@ledger/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/queries';
import { useUI, type Theme } from '@/stores/ui';
import { Button, Field, Input, PageHeader, Segmented, Sheet } from '@/components/ui';

const FEATURES = [
  { to: '/budgets', label: '預算', icon: Target, color: '#f97316' },
  { to: '/goals', label: '存錢目標', icon: Goal, color: '#0ea5e9' },
  { to: '/recurring', label: '定期交易', icon: Repeat, color: '#8b5cf6' },
  { to: '/templates', label: '常用模板', icon: Zap, color: '#eab308' },
  { to: '/calendar', label: '日曆', icon: CalendarDays, color: '#ec4899' },
  { to: '/accounts', label: '帳戶', icon: Wallet, color: '#10b981' },
  { to: '/installments', label: '分期付款', icon: Layers, color: '#a855f7' },
  { to: '/categories', label: '類別', icon: LayoutGrid, color: '#6366f1' },
];

export function SettingsPage() {
  const { data: me } = useMe();
  const { theme, setTheme } = useUI();
  const [profile, setProfile] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader title="更多" />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card flex items-center gap-4 p-5">
        <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-xl font-bold text-white">
          {me?.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{me?.name}</p>
          <p className="truncate text-sm text-muted">資料只存在這支手機</p>
        </div>
      </motion.div>

      <section className="grid grid-cols-4 gap-2 lg:hidden">
        {FEATURES.map((f, i) => (
          <motion.div key={f.to} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}>
            <Link to={f.to} className="card flex flex-col items-center gap-2 px-1 py-3.5 transition-transform active:scale-95">
              <span className="grid size-10 place-items-center rounded-2xl" style={{ background: `${f.color}1f`, color: f.color }}>
                <f.icon className="size-5" />
              </span>
              <span className="text-xs font-medium">{f.label}</span>
            </Link>
          </motion.div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">外觀</h2>
        <Segmented<Theme>
          layoutId="theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: <span className="flex items-center justify-center gap-1.5"><Sun className="size-4" />淺色</span> },
            { value: 'dark', label: <span className="flex items-center justify-center gap-1.5"><Moon className="size-4" />深色</span> },
            { value: 'system', label: <span className="flex items-center justify-center gap-1.5"><Monitor className="size-4" />系統</span> },
          ]}
        />
      </section>

      <section className="card divide-y divide-border overflow-hidden">
        <Row icon={<Coins className="size-5" />} label="幣別與匯率" hint={me?.baseCurrency} to="/settings/currency" />
        <Row icon={<ShieldCheck className="size-5" />} label="App 鎖（PIN／指紋／臉部）" hint={me?.pinEnabled ? '已啟用' : '未啟用'} to="/settings/security" />
        <Row icon={<DatabaseBackup className="size-5" />} label="匯入、匯出與備份" to="/settings/data" />
      </section>

      <section className="card divide-y divide-border overflow-hidden">
        <Row icon={<LayoutGrid className="size-5" />} label="類別管理" to="/categories" />
        <Row icon={<UserRound className="size-5" />} label="暱稱" hint={me?.name} onClick={() => setProfile(true)} />
      </section>

      <p className="text-center text-xs leading-relaxed text-muted">
        點滴記帳 v1.0 · 完全離線
        <br />
        不收集任何資料，記帳內容只存在這支手機並已加密
      </p>

      <ProfileSheet open={profile} onClose={() => setProfile(false)} me={me} />
    </div>
  );
}

function Row({ icon, label, hint, to, onClick }: { icon: React.ReactNode; label: string; hint?: string; to?: string; onClick?: () => void }) {
  const inner = (
    <span className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-surface-2/60">
      <span className="text-primary">{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      {hint && <span className="text-sm text-muted">{hint}</span>}
      <ChevronRight className="size-4 text-muted" />
    </span>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : <button onClick={onClick} className="block w-full text-left">{inner}</button>;
}

function ProfileSheet({ open, onClose, me }: { open: boolean; onClose: () => void; me?: User }) {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [name, setName] = useState(me?.name ?? '');
  const [loading, setLoading] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="個人資料">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          try {
            const u = await api.patch<User>('/auth/me', { name });
            qc.setQueryData(['me'], u);
            toast({ message: '已更新' });
            onClose();
          } catch (err) {
            toast({ message: (err as Error).message, tone: 'error' });
          } finally {
            setLoading(false);
          }
        }}
      >
        <Field label="名稱">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
        <Button type="submit" className="h-12 w-full" loading={loading}>儲存</Button>
      </form>
    </Sheet>
  );
}
