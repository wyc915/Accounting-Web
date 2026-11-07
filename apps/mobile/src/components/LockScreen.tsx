import { useEffect, useRef, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { Delete, Fingerprint, Lock, ScanFace } from 'lucide-react';
import type { User } from '@ledger/shared';
import { api } from '@/lib/api';
import { biometricInfo, biometricUnlock, type BioInfo } from '@/lib/biometric';
import { cn } from '@/lib/format';
import { tap, warn } from '@/lib/native';
import { useUI } from '@/stores/ui';
import { Sheet } from './ui';

/** Full-screen PIN pad; optional fingerprint / face unlock (PIN always available) */
export function LockScreen({ user }: { user: User }) {
  const setLocked = useUI((s) => s.setLocked);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState<BioInfo | null>(null);
  const [forgot, setForgot] = useState(false);
  const shake = useAnimationControls();
  const pinRef = useRef(pin);
  pinRef.current = pin;

  const unlock = () => setLocked(false);

  const tryBiometric = async () => {
    if (await biometricUnlock()) unlock();
  };

  // offer biometrics automatically when enabled
  useEffect(() => {
    if (!user.biometric) return;
    biometricInfo().then((b) => {
      setBio(b);
      if (b.available) tryBiometric();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (value = pinRef.current) => {
    if (value.length < 4 || busy) return;
    setBusy(true);
    try {
      await api.post('/auth/pin/verify', { pin: value });
      unlock();
    } catch (e) {
      setMsg((e as Error).message);
      setPin('');
      warn();
      shake.start({ x: [0, -14, 12, -8, 6, 0], transition: { duration: 0.42 } });
    } finally {
      setBusy(false);
    }
  };

  const press = (k: string) => {
    setMsg('');
    tap();
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

  const BioIcon = bio?.label === '臉部辨識' ? ScanFace : Fingerprint;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[80] grid place-items-center overflow-hidden bg-bg px-6">
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
            <motion.span key={i} animate={{ scale: i < pin.length ? 1 : 0.7 }} className={cn('size-3.5 rounded-full transition-colors', i < pin.length ? 'bg-primary' : 'bg-border')} />
          ))}
        </motion.div>
        <p className="mb-4 h-5 text-sm font-medium text-expense">{msg}</p>

        <div className="grid grid-cols-3 gap-3">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'back'].map((k) =>
            k === 'bio' ? (
              user.biometric && bio?.available ? (
                <motion.button key={k} whileTap={{ scale: 0.88 }} onClick={tryBiometric} aria-label={bio.label} className="grid h-16 place-items-center rounded-full text-primary">
                  <BioIcon className="size-8" />
                </motion.button>
              ) : (
                <span key={k} />
              )
            ) : (
              <motion.button
                key={k}
                whileTap={{ scale: 0.88 }}
                disabled={busy}
                onClick={() => press(k)}
                aria-label={k === 'back' ? '刪除' : k}
                className="grid h-16 place-items-center rounded-full bg-surface-2 text-2xl font-semibold transition-colors active:bg-border"
              >
                {k === 'back' ? <Delete className="size-6" /> : k}
              </motion.button>
            ),
          )}
        </div>
        <button
          onClick={() => press('ok')}
          disabled={pin.length < 4 || busy}
          className="mt-5 h-12 w-full rounded-2xl bg-primary font-bold text-white transition-opacity disabled:opacity-40 dark:text-[#06231a]"
        >
          解鎖
        </button>
        <button onClick={() => setForgot(true)} className="mt-5 text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
          忘記 PIN？
        </button>
      </div>

      <Sheet open={forgot} onClose={() => setForgot(false)} title="忘記 PIN">
        <p className="text-sm leading-relaxed text-muted">
          為了保護你的資料，PIN 無法重設或略過。資料只存在這支手機上並已加密，沒有伺服器可以幫你找回。
          <br />
          <br />
          如果你有開啟{bio?.label ?? '生物辨識'}，可用它解鎖後到「更多 → 安全性」變更 PIN。否則只能到系統設定清除本 App 資料（所有紀錄將刪除），再從先前匯出的備份檔還原。
        </p>
      </Sheet>
    </motion.div>
  );
}
