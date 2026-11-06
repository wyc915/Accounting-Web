import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, ChevronRight, Coins, DatabaseBackup, Goal, KeyRound, Layers, LayoutGrid, LogOut, Monitor, Moon, Repeat, ShieldCheck, Sun,
  Target, UserRound, Wallet, Zap,
} from 'lucide-react';
import { passwordSchema, type User } from '@ledger/shared';
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
  const { theme, setTheme, toast } = useUI();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [profile, setProfile] = useState(false);
  const [pwd, setPwd] = useState(false);

  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    nav('/login', { replace: true });
    toast({ message: '已登出' });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="更多" />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card flex items-center gap-4 p-5">
        <span className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 text-xl font-bold text-white">
          {me?.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{me?.name}</p>
          <p className="truncate text-sm text-muted">{me?.email}</p>
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
        <Row icon={<ShieldCheck className="size-5" />} label="安全性與 PIN 鎖" hint={me?.pinEnabled ? '已啟用' : '未啟用'} to="/settings/security" />
        <Row icon={<DatabaseBackup className="size-5" />} label="匯入、匯出與備份" to="/settings/data" />
      </section>

      <section className="card divide-y divide-border overflow-hidden">
        <Row icon={<LayoutGrid className="size-5" />} label="類別管理" to="/categories" />
        <Row icon={<UserRound className="size-5" />} label="個人資料" onClick={() => setProfile(true)} />
        <Row icon={<KeyRound className="size-5" />} label="變更密碼" onClick={() => setPwd(true)} />
      </section>

      <Button variant="danger" className="w-full" onClick={logout}>
        <LogOut className="size-4" /> 登出
      </Button>
      <p className="text-center text-xs text-muted">點滴記帳 v0.3</p>

      <ProfileSheet open={profile} onClose={() => setProfile(false)} me={me} />
      <PasswordSheet open={pwd} onClose={() => setPwd(false)} />
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
        <Field label="Email">
          <Input value={me?.email ?? ''} disabled className="opacity-60" />
        </Field>
        <Button type="submit" className="h-12 w-full" loading={loading}>儲存</Button>
      </form>
    </Sheet>
  );
}

function PasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useUI((s) => s.toast);
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title="變更密碼">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (f.next !== f.confirm) return toast({ message: '兩次輸入的新密碼不一致', tone: 'error' });
          const p = passwordSchema.safeParse(f);
          if (!p.success) return toast({ message: p.error.issues[0].message, tone: 'error' });
          setLoading(true);
          try {
            await api.post('/auth/password', p.data);
            toast({ message: '密碼已更新' });
            setF({ current: '', next: '', confirm: '' });
            onClose();
          } catch (err) {
            toast({ message: (err as Error).message, tone: 'error' });
          } finally {
            setLoading(false);
          }
        }}
      >
        <Field label="目前密碼">
          <Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </Field>
        <Field label="新密碼">
          <Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} placeholder="至少 8 碼" />
        </Field>
        <Field label="確認新密碼">
          <Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <Button type="submit" className="h-12 w-full" loading={loading}>更新密碼</Button>
      </form>
    </Sheet>
  );
}
