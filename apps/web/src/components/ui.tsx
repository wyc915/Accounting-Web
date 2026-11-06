import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { cn, money } from '@/lib/format';
import { useUI } from '@/stores/ui';

export const spring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const;

/* ---------- Media ---------- */
export function useIsDesktop() {
  const q = '(min-width: 1024px)';
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return m;
}

/* ---------- Button ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'soft' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'primary', size = 'md', loading, className, children, disabled, ...p },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.96 }}
      transition={spring}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-2xl font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        {
          primary: 'bg-primary text-white shadow-[0_8px_20px_-8px_var(--primary)] hover:bg-primary-strong dark:text-[#06231a]',
          ghost: 'text-fg hover:bg-surface-2',
          soft: 'bg-primary-soft text-primary-strong hover:brightness-95 dark:text-primary',
          danger: 'bg-expense/10 text-expense hover:bg-expense/15',
          outline: 'border border-border bg-surface hover:bg-surface-2',
        }[variant],
        { sm: 'h-9 px-3 text-sm', md: 'h-11 px-4 text-[15px]', lg: 'h-13 px-6 text-base', icon: 'size-10' }[size],
        className,
      )}
      {...(p as object)}
    >
      {loading ? <span className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : children}
    </motion.button>
  );
});

/* ---------- Input ---------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-12 w-full rounded-2xl border border-border bg-surface-2/60 px-4 text-[15px] text-fg placeholder:text-muted outline-none transition focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/15',
        className,
      )}
      {...p}
    />
  );
});

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
      {error && <span className="block text-xs text-expense">{error}</span>}
    </label>
  );
}

/* ---------- Segmented ---------- */
export function Segmented<T extends string>({
  value, onChange, options, layoutId, className, size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; activeClass?: string }[];
  layoutId: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cn('relative flex rounded-2xl bg-surface-2 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'relative flex-1 rounded-xl font-semibold transition-colors',
              size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-3 text-sm',
              active ? (o.activeClass ?? 'text-fg') : 'text-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span layoutId={layoutId} transition={spring} className="absolute inset-0 rounded-xl bg-surface shadow-card" />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Animated number ---------- */
export function AnimatedMoney({ value, className, sign }: { value: number; className?: string; sign?: boolean }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => money(Math.round(v * 100) / 100, { sign }));
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return c.stop;
  }, [value, mv]);
  return <motion.span className={cn('num', className)}>{text}</motion.span>;
}

/* ---------- Sheet (bottom sheet on mobile, dialog on desktop) ---------- */
export function Sheet({
  open, onClose, title, children, footer, wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const desktop = useIsDesktop();
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center">
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal
            className={cn(
              'relative flex max-h-[94dvh] w-full flex-col overflow-hidden bg-surface shadow-2xl',
              desktop ? cn('rounded-3xl', wide ? 'max-w-2xl' : 'max-w-md') : 'rounded-t-[28px]',
            )}
            initial={desktop ? { opacity: 0, scale: 0.94, y: 12 } : { y: '100%' }}
            animate={desktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={desktop ? { opacity: 0, scale: 0.96, y: 8 } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            drag={desktop ? false : 'y'}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <div className="shrink-0 touch-none" onPointerDown={(e) => !desktop && controls.start(e)}>
            {!desktop && <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border" />}
            {title && (
              <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-3 lg:pt-5">
                <h2 className="text-lg font-bold">{title}</h2>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="關閉" className="-mr-2 rounded-full">
                  <X className="size-5" />
                </Button>
              </div>
            )}
            {!title && <div className="h-3" />}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
              {children}
            </div>
            {footer && <div className="shrink-0 border-t border-border px-5 py-3 safe-bottom">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Confirm ---------- */
export function Confirm({
  open, title, message, confirmText = '確認', onConfirm, onClose, danger = true, loading,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {message && <p className="text-sm leading-relaxed text-muted">{message}</p>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={onClose}>取消</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmText}</Button>
      </div>
    </Sheet>
  );
}

/* ---------- Toaster ---------- */
export function Toaster() {
  const { toasts, dismiss } = useUI();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={spring}
            className={cn(
              'pointer-events-auto flex min-w-[240px] max-w-sm items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium shadow-xl',
              t.tone === 'error' ? 'bg-expense text-white' : t.tone === 'warn' ? 'bg-amber-500 text-white' : 'bg-fg text-bg',
            )}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                className={cn('font-bold', t.tone ? 'text-white underline' : 'text-primary')}
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Empty ---------- */
export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center py-14 text-center">
      <div className="mb-4 grid size-16 place-items-center rounded-3xl bg-primary-soft text-primary">{icon}</div>
      <p className="font-semibold">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>
      </div>
      {right}
    </div>
  );
}
