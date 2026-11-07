import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { App as CapApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './index.css';
import type { User } from '@ledger/shared';
import { useMe } from '@/lib/queries';
import { api } from '@/lib/api';
import { setBaseCurrency } from '@/lib/format';
import { isNative, syncStatusBar } from '@/lib/native';
import { LockScreen } from '@/components/LockScreen';
import { PrivacyCover } from '@/components/PrivacyCover';
import { CurrencyPage } from '@/pages/Currency';
import { SecurityPage } from '@/pages/Security';
import { DataPage } from '@/pages/DataTools';
import { InstallmentsPage } from '@/pages/Installments';
import { OnboardingPage } from '@/pages/Onboarding';
import { applyTheme, useUI } from '@/stores/ui';
import { Layout } from '@/components/Layout';
import { Toaster } from '@/components/ui';
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
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 0 } },
});

/** open DB → onboarding → PIN lock → app */
function AppGate() {
  const { data, isLoading, isError, error, refetch } = useMe();
  const { locked, lockChecked, setLocked } = useUI();
  useEffect(() => {
    if (data && !lockChecked) setLocked(!!data.pinEnabled);
  }, [data, lockChecked, setLocked]);
  useEffect(() => {
    if (!isLoading) SplashScreen.hide().catch(() => {});
  }, [isLoading]);
  useAutoLock(data ?? undefined);

  if (isLoading || (data && !lockChecked))
    return (
      <div className="grid min-h-dvh place-items-center">
        <img src="/icon.svg" alt="" className="size-14 animate-pulse" />
      </div>
    );
  if (isError || !data)
    return (
      <div className="grid min-h-dvh place-items-center px-8 text-center">
        <div>
          <p className="text-lg font-bold">無法開啟資料庫</p>
          <p className="mt-2 text-sm text-muted">{(error as Error)?.message}</p>
          <button className="mt-6 rounded-2xl bg-primary px-5 py-3 font-semibold text-white" onClick={() => refetch()}>
            重試
          </button>
        </div>
      </div>
    );
  setBaseCurrency(data.baseCurrency);
  if (!data.onboarded) return <OnboardingPage />;
  if (locked) return <LockScreen user={data} />;
  return <Outlet />;
}

/** Lock after `lockMinutes` in the background or idle; post due recurring items on resume */
function useAutoLock(me?: User) {
  useEffect(() => {
    if (!me?.onboarded) return;
    let lastActive = Date.now();
    let hiddenAt = 0;
    const limit = () => (me.lockMinutes || 1) * 60_000;
    const lock = () => me.pinEnabled && useUI.getState().setLocked(true);
    const onHide = () => {
      hiddenAt = Date.now();
      useUI.getState().setCovered(true);
    };
    const onShow = async () => {
      useUI.getState().setCovered(false);
      if (hiddenAt && Date.now() - hiddenAt >= limit()) lock();
      hiddenAt = 0;
      const n = await api.post<number>('/app/recurring/process').catch(() => 0);
      if (n) qc.invalidateQueries();
    };
    const activity = () => (lastActive = Date.now());
    const tick = setInterval(() => {
      if (!useUI.getState().locked && Date.now() - lastActive >= limit() * 5) lock(); // long idle in foreground
    }, 10_000);
    const subs: Promise<{ remove: () => Promise<void> }>[] = [];
    if (isNative) {
      subs.push(CapApp.addListener('pause', onHide));
      subs.push(CapApp.addListener('resume', onShow));
    }
    const onVis = () => (document.visibilityState === 'hidden' ? onHide() : onShow());
    if (!isNative) document.addEventListener('visibilitychange', onVis);
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    return () => {
      clearInterval(tick);
      subs.forEach((s) => s.then((h) => h.remove()));
      document.removeEventListener('visibilitychange', onVis);
      evs.forEach((e) => window.removeEventListener(e, activity));
    };
  }, [me?.onboarded, me?.pinEnabled, me?.lockMinutes]);
}

function GlobalEffects() {
  const nav = useNavigate();
  const theme = useUI((s) => s.theme);
  const openEditor = useUI((s) => s.openEditor);
  useEffect(() => {
    applyTheme(theme);
    syncStatusBar(document.documentElement.classList.contains('dark'));
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => {
      applyTheme('system');
      syncStatusBar(mq.matches);
    };
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [theme]);

  // Android back: close sheet → previous page → leave app
  useEffect(() => {
    if (!isNative) return;
    const sub = CapApp.addListener('backButton', () => {
      if (document.querySelector('[role="dialog"]')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        return;
      }
      if (location.pathname !== '/' && !useUI.getState().locked) nav(-1);
      else CapApp.minimizeApp();
    });
    return () => {
      sub.then((s) => s.remove());
    };
  }, [nav]);

  // "N" shortcut (keyboard / emulator)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || useUI.getState().editor || useUI.getState().locked) return;
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
            <Route element={<AppGate />}>
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
          <PrivacyCover />
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
