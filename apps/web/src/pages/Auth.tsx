import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { loginSchema, registerSchema, type User } from '@ledger/shared';
import { api } from '@/lib/api';
import { Button, Field, Input } from '@/components/ui';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const reg = mode === 'register';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const parsed = (reg ? registerSchema : loginSchema).safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setLoading(true);
    try {
      const user = await api.post<User>(reg ? '/auth/register' : '/auth/login', parsed.data);
      qc.clear();
      qc.setQueryData(['me'], user);
      nav('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      {/* ambient blobs */}
      <motion.div
        className="pointer-events-none absolute -left-32 -top-32 size-[420px] rounded-full bg-emerald-300/40 blur-3xl dark:bg-emerald-500/15"
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-40 -right-24 size-[460px] rounded-full bg-teal-300/40 blur-3xl dark:bg-teal-500/15"
        animate={{ x: [0, -30, 0], y: [0, -40, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <motion.img
            src="/icon.svg"
            alt=""
            className="mx-auto mb-4 size-16 drop-shadow-[0_12px_24px_rgb(16_185_129/0.35)]"
            initial={{ rotate: -12, scale: 0.8 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}
          />
          <h1 className="text-2xl font-extrabold tracking-tight">{reg ? '建立帳號' : '歡迎回來'}</h1>
          <p className="mt-1 text-sm text-muted">{reg ? '開始輕鬆管理每一筆收支' : '登入點滴記帳，繼續記錄生活'}</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 border-white/60 bg-surface/80 p-6 backdrop-blur-xl dark:border-border">
          {reg && (
            <Field label="名稱">
              <Input value={form.name} onChange={set('name')} placeholder="你的暱稱" autoComplete="nickname" />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" />
          </Field>
          <Field label="密碼">
            <Input
              type="password"
              value={form.password}
              onChange={set('password')}
              placeholder={reg ? '至少 8 碼' : '••••••••'}
              autoComplete={reg ? 'new-password' : 'current-password'}
            />
          </Field>
          {error && (
            <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [6, -4, 2, 0] }} className="rounded-xl bg-expense/10 px-3 py-2 text-sm text-expense">
              {error}
            </motion.p>
          )}
          <Button type="submit" size="lg" className="h-12 w-full" loading={loading}>
            {reg ? '註冊' : '登入'}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          {reg ? '已經有帳號了？' : '還沒有帳號？'}
          <Link to={reg ? '/login' : '/register'} className="ml-1 font-semibold text-primary">
            {reg ? '登入' : '立即註冊'}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
