import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import './index.css';
import type { User } from '@ledger/shared';
import { useMe } from '@/lib/queries';
import { api } from '@/lib/api';
import { setBaseCurrency } from '@/lib/format';
import { LockScreen } from '@/components/LockScreen';
import { CurrencyPage } from '@/pages/Currency';
import { SecurityPage } from '@/pages/Security';
import { DataPage } from '@/pages/DataTools';
import { InstallmentsPage } from '@/pages/Installments';
import { applyTheme, useUI } from '@/stores/ui';
import { Layout } from '@/components/Layout';
import { Toaster } from '@/components/ui';
import { AuthPage } from '@/pages/Auth';
import { HomePage } from '@/pages/Home';
import { TransactionsPage } from '@/pages/Transactions';
import { AccountsPage } from '@/pages/Accounts';
import { CategoriesPage } from '@/pages/Categories';
import { SettingsPage } from '@/pages/Settings';
import { CalendarPage } from '@/pages/Calendar';
import { BudgetsPage } from '@/pages/Budgets';
import { RecurringPage } from '@/pages/Recurring';
import { TemplatesPage } from '@/pages/Templates';
import { GoalsPage } from '@/pages/Goals';

// charts library only loads when the reports page is opened
const StatsPage = lazy(() => import('@/pages/Stats').then((m) => ({ default: m.StatsPage })));

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
});

function RequireAuth() {
  const { data, isLoading, isError } = useMe();
  useAutoLock(data ?? undefined);
  if (isLoading)
    return (
      <div className="grid min-h-dvh place-items-center">
        <img src="/icon.svg" alt="" className="size-12 animate-pulse" />
      </div>
    );
  if (isError || !data) return <Navigate to="/login" replace />;
  setBaseCurrency(data.baseCurrency);
  if (data.locked) return <LockScreen user={data} />;
  return <Outlet />;
}

/** Locks after `lockMinutes` without interaction; keeps the server-side unlock alive while active */
function useAutoLock(me?: User) {
  useEffect(() => {
    if (!me?.pinEnabled || me.locked) return;
    let last = Date.now();
    let lastPing = Date.now();
    const lock = () => {
      api.post('/auth/lock').catch(() => {});
      qc.setQueryData<User>(['me'], (m) => (m ? { ...m, locked: true } : m));
      useUI.getState().closeEditor();
    };
    const activity = () => {
      last = Date.now();
      if (Date.now() - lastPing > 60_000) {
        lastPing = Date.now();
        api.post('/auth/ping').catch(() => {});
      }
    };
    const tick = setInterval(() => {
      if (Date.now() - last > me.lockMinutes * 60_000) lock();
    }, 5000);
    const onVis = () => {
      if (document.visibilityState === 'visible' && Date.now() - last > me.lockMinutes * 60_000) lock();
    };
    const evs = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(tick);
      evs.forEach((e) => window.removeEventListener(e, activity));
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [me?.pinEnabled, me?.locked, me?.lockMinutes]);
}

function GuestOnly() {
  const { data, isLoading } = useMe();
  if (isLoading) return null;
  if (data) return <Navigate to="/" replace />;
  return <Outlet />;
}

function GlobalEffects() {
  const nav = useNavigate();
  const theme = useUI((s) => s.theme);
  const openEditor = useUI((s) => s.openEditor);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme('system');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [theme]);
  useEffect(() => {
    const h = () => {
      qc.setQueryData(['me'], null);
      qc.removeQueries({ queryKey: ['me'] });
      nav('/login', { replace: true });
    };
    window.addEventListener('auth:expired', h);
    const locked = () => {
      qc.setQueryData<User>(['me'], (m) => (m ? { ...m, locked: true } : m));
      useUI.getState().closeEditor();
    };
    window.addEventListener('app:locked', locked);
    return () => {
      window.removeEventListener('auth:expired', h);
      window.removeEventListener('app:locked', locked);
    };
  }, [nav]);
  // "N" shortcut to add
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || useUI.getState().editor) return;
      if (!qc.getQueryData(['me'])) return;
      e.preventDefault();
      openEditor();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [openEditor]);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <GlobalEffects />
          <Routes>
            <Route element={<GuestOnly />}>
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/register" element={<AuthPage mode="register" />} />
            </Route>
            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route index element={<HomePage />} />
                <Route path="/transactions" element={<TransactionsPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/categories" element={<CategoriesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/stats" element={<Suspense fallback={<div className="h-dvh" />}><StatsPage /></Suspense>} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/budgets" element={<BudgetsPage />} />
                <Route path="/recurring" element={<RecurringPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/goals" element={<GoalsPage />} />
                <Route path="/installments" element={<InstallmentsPage />} />
                <Route path="/settings/currency" element={<CurrencyPage />} />
                <Route path="/settings/security" element={<SecurityPage />} />
                <Route path="/settings/data" element={<DataPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster />
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
