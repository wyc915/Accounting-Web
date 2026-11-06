import { useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { Delete, Lock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@ledger/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';

/** Full-screen PIN pad shown while the server reports the session as locked */
export function LockScreen({ user }: { user: User }) {
  const qc = useQueryClient();
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const shake = useAnimationControls();
  const pinRef = useRef(pin);
  pinRef.current = pin;

  const submit = async (value = pinRef.current) => {
    if (value.length < 4 || busy) return;
    setBusy(true);
    try {
      await api.post('/auth/pin/verify', { pin: value });
      qc.setQueryData<User>(['me'], (m) => (m ? { ...m, locked: false } : m));
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    } catch (e) {
      setMsg((e as Error).message);
      setPin('');
      shake.start({ x: [0, -14, 12, -8, 6, 0], transition: { duration: 0.42 } });
      navigator.vibrate?.(120);
    } finally {
      setBusy(false);
    }
  };

  const press = (k: string) => {
    setMsg('');
    if (k === 'back') return setPin((p) => p.slice(0, -1));
    if (k === 'ok') return submit();
    setPin((p) => {
      const next = (p + k).slice(0, 6);
      if (next.length === 6) setTimeout(() => submit(next), 80);
      return next;
    });
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('back');
      else if (e.key === 'Enter') press('ok');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    location.href = '/login';
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[80] grid place-items-center overflow-hidden bg-bg px-6"
    >
      <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-emerald-300/30 blur-3xl dark:bg-emerald-500/10" />
      <div className="pointer-events-none absolute -bottom-28 -right-20 size-96 rounded-full bg-teal-300/30 blur-3xl dark:bg-teal-500/10" />
      <div className="relative w-full max-w-xs text-center">
        <motion.div
          initial={{ scale: 0.7, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 14 }}
          className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-[0_14px_30px_-10px_#10b981]"
        >
          <Lock className="size-7" />
        </motion.div>
        <h1 className="text-xl font-extrabold">輸入 PIN 解鎖</h1>
        <p className="mt-1 text-sm text-muted">{user.name}，歡迎回來</p>

        <motion.div animate={shake} className="my-7 flex h-4 justify-center gap-3">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <motion.span
              key={i}
              animate={{ scale: i < pin.length ? 1 : 0.7 }}
              className={cn('size-3.5 rounded-full transition-colors', i < pin.length ? 'bg-primary' : 'bg-border')}
            />
          ))}
        </motion.div>
        <p className="mb-4 h-5 text-sm font-medium text-expense">{msg}</p>

        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok'].map((k) => (
            <motion.button
              key={k}
              whileTap={{ scale: 0.88 }}
              disabled={busy}
              onClick={() => press(k)}
              aria-label={k === 'back' ? '刪除' : k === 'ok' ? '確認' : k}
              className={cn(
                'grid h-16 place-items-center rounded-full text-2xl font-semibold transition-colors',
                k === 'ok' ? 'bg-primary text-base font-bold text-white dark:text-[#06231a]' : 'bg-surface-2 active:bg-border',
                k === 'ok' && pin.length < 4 && 'opacity-40',
              )}
            >
              {k === 'back' ? <Delete className="size-6" /> : k === 'ok' ? '解鎖' : k}
            </motion.button>
          ))}
        </div>
        <button onClick={logout} className="mt-7 text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
          忘記 PIN？改用密碼登入
        </button>
      </div>
    </motion.div>
  );
}
