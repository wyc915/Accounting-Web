import { NavLink, useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CalendarDays, ChartPie, Goal, House, Layers, LayoutGrid, ListOrdered, Menu, Plus, Repeat, Settings, Target, Wallet, Zap,
} from 'lucide-react';
import { cn } from '@/lib/format';
import { useMe } from '@/lib/queries';
import { useUI } from '@/stores/ui';
import { TransactionEditor } from './TransactionEditor';
import { spring } from './ui';

const NAV_GROUPS = [
  [
    { to: '/', label: '首頁', icon: House },
    { to: '/transactions', label: '明細', icon: ListOrdered },
    { to: '/stats', label: '報表', icon: ChartPie },
    { to: '/calendar', label: '日曆', icon: CalendarDays },
  ],
  [
    { to: '/budgets', label: '預算', icon: Target },
    { to: '/goals', label: '存錢目標', icon: Goal },
    { to: '/recurring', label: '定期交易', icon: Repeat },
    { to: '/templates', label: '常用模板', icon: Zap },
    { to: '/installments', label: '分期付款', icon: Layers },
  ],
  [
    { to: '/accounts', label: '帳戶', icon: Wallet },
    { to: '/categories', label: '類別', icon: LayoutGrid },
    { to: '/settings', label: '設定', icon: Settings },
  ],
];
const NAV = NAV_GROUPS.flat();
const MORE_PATHS = ['/settings', '/budgets', '/goals', '/recurring', '/templates', '/installments', '/accounts', '/categories', '/calendar'];
const MOBILE = [NAV[0], NAV[1], null, NAV[2], { to: '/settings', label: '更多', icon: Menu }] as const;

export function Layout() {
  const loc = useLocation();
  const outlet = useOutlet();
  const openEditor = useUI((s) => s.openEditor);
  const { data: me } = useMe();

  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-surface/60 px-4 py-6 backdrop-blur lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="/icon.svg" alt="" className="size-9" />
          <span className="text-lg font-extrabold tracking-tight">點滴記帳</span>
        </div>
        <motion.button
          whileHover={{ y: -1 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => openEditor()}
          className="mb-5 flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 font-semibold text-white shadow-[0_10px_24px_-10px_#10b981]"
        >
          <Plus className="size-5" strokeWidth={2.5} /> 記一筆
          <kbd className="ml-1 rounded-md bg-white/20 px-1.5 text-[11px] font-medium">N</kbd>
        </motion.button>
        <nav className="-mx-1 flex-1 space-y-4 overflow-y-auto px-1">
          {NAV_GROUPS.map((group, gi) => (
           <div key={gi} className="space-y-1">
          {group.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="relative block">
              {({ isActive }) => (
                <span className={cn('relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors', isActive ? 'text-primary-strong dark:text-primary' : 'text-muted hover:text-fg')}>
                  {isActive && <motion.span layoutId="side-active" transition={spring} className="absolute inset-0 rounded-xl bg-primary-soft" />}
                  <n.icon className="relative size-5" />
                  <span className="relative">{n.label}</span>
                </span>
              )}
            </NavLink>
          ))}
           </div>
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
          <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-bold text-white dark:text-[#06231a]">
            {me?.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{me?.name}</p>
            <p className="truncate text-xs text-muted">{me?.email}</p>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="relative min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={loc.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto w-full max-w-3xl px-4 pb-32 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6 lg:pb-12 lg:pt-10"
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile tab bar */}
      <nav className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 lg:hidden">
        <div className="mx-auto flex h-16 max-w-md items-center justify-around rounded-[26px] border border-border bg-surface/85 px-2 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.25)] backdrop-blur-xl">
          {MOBILE.map((n, i) =>
            n ? (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className="relative flex w-14 flex-col items-center gap-0.5 py-1">
                {({ isActive: exact }) => {
                  const isActive = n.label === '更多' ? MORE_PATHS.some((p) => loc.pathname === p || loc.pathname.startsWith(p + '/')) : exact;
                  return (
                  <>
                    {isActive && <motion.span layoutId="tab-active" transition={spring} className="absolute -top-1 h-1 w-6 rounded-full bg-primary" />}
                    <n.icon className={cn('size-[22px] transition-colors', isActive ? 'text-primary' : 'text-muted')} strokeWidth={isActive ? 2.4 : 2} />
                    <span className={cn('text-[10px] font-medium', isActive ? 'text-fg' : 'text-muted')}>{n.label}</span>
                  </>
                  );
                }}
              </NavLink>
            ) : (
              <motion.button
                key={i}
                onClick={() => openEditor()}
                whileTap={{ scale: 0.88, rotate: 90 }}
                transition={spring}
                className="-mt-7 grid size-14 place-items-center rounded-[20px] bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-[0_12px_28px_-8px_#10b981]"
                aria-label="記一筆"
              >
                <Plus className="size-7" strokeWidth={2.5} />
              </motion.button>
            ),
          )}
        </div>
      </nav>

      <TransactionEditor />
    </div>
  );
}
