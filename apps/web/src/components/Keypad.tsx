import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Delete } from 'lucide-react';
import { cn } from '@/lib/format';
import { OPS, evaluate, hasOperator } from '@/lib/calc';

/** Calculator keypad. `expr` is the raw expression string. */
export function Keypad({
  expr, setExpr, onSubmit, submitLabel, accent, loading,
}: {
  expr: string;
  setExpr: (s: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  accent: string;
  loading?: boolean;
}) {
  const press = (k: string) => {
    if (k === 'back') return setExpr(expr.slice(0, -1));
    if (k === 'clear') return setExpr('');
    if (k === '=') {
      const v = evaluate(expr);
      return setExpr(v == null ? '' : String(v));
    }
    const last = expr.slice(-1);
    if (OPS.includes(k as never)) {
      if (!expr) return;
      if (OPS.includes(last as never)) return setExpr(expr.slice(0, -1) + k);
      return setExpr(expr + k);
    }
    // number segment rules
    const seg = expr.split(/[+−×÷]/).pop() ?? '';
    if (k === '.') {
      if (seg.includes('.')) return;
      return setExpr(expr + (seg === '' ? '0.' : '.'));
    }
    if (seg.includes('.') && seg.split('.')[1].length >= 2) return;
    if (seg === '0') return setExpr(expr.slice(0, -1) + k);
    if (seg.replace('.', '').length >= 10) return;
    setExpr(expr + k);
  };

  // physical keyboard support
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      const map: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', Backspace: 'back', Escape: '' };
      if (/^[0-9.]$/.test(e.key)) press(e.key);
      else if (map[e.key]) press(map[e.key]);
      else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        hasOperator(expr) && e.key === '=' ? press('=') : onSubmit();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const pending = hasOperator(expr);
  const keys = ['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '.', '0', 'back', '+'];

  return (
    <div className="grid grid-cols-[repeat(4,1fr)_1.15fr] gap-2">
      <div className="col-span-4 grid grid-cols-4 gap-2">
        {keys.map((k) => (
          <Key key={k} onClick={() => press(k)} onLongPress={k === 'back' ? () => press('clear') : undefined} op={OPS.includes(k as never)}>
            {k === 'back' ? <Delete className="size-5" /> : k}
          </Key>
        ))}
      </div>
      <motion.button
        type="button"
        whileTap={{ scale: 0.95 }}
        disabled={loading}
        onClick={() => (pending ? press('=') : onSubmit())}
        className="flex flex-col items-center justify-center rounded-2xl text-lg font-bold text-white shadow-lg transition-colors disabled:opacity-60"
        style={{ background: accent, boxShadow: `0 10px 24px -10px ${accent}` }}
      >
        {loading ? (
          <span className="size-5 animate-spin rounded-full border-2 border-white border-r-transparent" />
        ) : pending ? (
          '='
        ) : (
          <span className="[writing-mode:vertical-rl] tracking-[0.3em] sm:[writing-mode:horizontal-tb] sm:tracking-normal">{submitLabel}</span>
        )}
      </motion.button>
    </div>
  );
}

function Key({ children, onClick, onLongPress, op }: { children: React.ReactNode; onClick: () => void; onLongPress?: () => void; op?: boolean }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fired = false;
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      onPointerDown={() => {
        fired = false;
        if (onLongPress) timer = setTimeout(() => { fired = true; onLongPress(); }, 450);
      }}
      onPointerUp={() => clearTimeout(timer)}
      onPointerLeave={() => clearTimeout(timer)}
      onClick={() => !fired && onClick()}
      className={cn(
        'grid h-13 place-items-center rounded-2xl text-xl font-semibold transition-colors active:bg-border',
        op ? 'bg-primary-soft/70 text-primary-strong dark:text-primary' : 'bg-surface-2 text-fg',
      )}
    >
      {children}
    </motion.button>
  );
}
