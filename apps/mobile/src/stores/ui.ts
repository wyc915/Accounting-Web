import { create } from 'zustand';
import type { Transaction, TxType } from '@ledger/shared';

export type TxDraft = {
  type?: TxType;
  amount?: number | null;
  accountId?: number | null;
  toAccountId?: number | null;
  categoryId?: number | null;
  note?: string;
  date?: Date;
  installment?: boolean;
};

export type Theme = 'light' | 'dark' | 'system';

const readTheme = (): Theme => {
  try {
    return (localStorage.getItem('theme') as Theme) || 'system';
  } catch {
    return 'system';
  }
};

export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1210' : '#10b981');
}

type Toast = { id: number; message: string; tone?: 'default' | 'error' | 'warn'; action?: { label: string; onClick: () => void } };

interface UI {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** transaction editor sheet: null closed, {} new, {tx} edit */
  editor: null | { tx?: Transaction; draft?: TxDraft; nonce: number };
  openEditor: (tx?: Transaction, draft?: TxDraft) => void;
  closeEditor: () => void;
  /** app lock (PIN / biometric) — client state, decided on launch and resume */
  locked: boolean;
  lockChecked: boolean;
  setLocked: (v: boolean) => void;
  /** privacy cover while the app is in the background */
  covered: boolean;
  setCovered: (v: boolean) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'> & { duration?: number }) => void;
  dismiss: (id: number) => void;
}

let tid = 0;
let editorNonce = 0;
export const useUI = create<UI>((set, get) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* ignore */
    }
    applyTheme(theme);
    set({ theme });
  },
  editor: null,
  openEditor: (tx, draft) => set({ editor: { tx, draft, nonce: ++editorNonce } }),
  closeEditor: () => set({ editor: null }),
  locked: false,
  lockChecked: false,
  setLocked: (locked) => set({ locked, lockChecked: true, ...(locked ? { editor: null } : {}) }),
  covered: false,
  setCovered: (covered) => set({ covered }),
  toasts: [],
  toast: ({ duration = 3500, ...t }) => {
    const id = ++tid;
    set({ toasts: [...get().toasts.slice(-2), { ...t, id }] });
    setTimeout(() => get().dismiss(id), duration);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
