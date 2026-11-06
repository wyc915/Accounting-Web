import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  Account, AccountInput, Budget, BudgetInput, Category, CategoryInput, CategoryStat, Goal, GoalEntry, GoalInput,
  RecurringInput, RecurringRule, Summary, Tag, Template, TemplateInput, Transaction, TransactionInput, TrendPoint, User,
} from '@ledger/shared';
import { api, qs } from './api';

export type TxFilter = {
  from?: string;
  to?: string;
  q?: string;
  type?: string;
  categoryIds?: number[];
  accountIds?: number[];
  tagIds?: number[];
  min?: string;
  max?: string;
  limit?: number;
};

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api.get<User>('/auth/me'), retry: false, staleTime: Infinity });

export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/accounts') });
export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/categories'), staleTime: 60_000 });
export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api.get<Tag[]>('/tags') });

export const useTransactions = (f: TxFilter) =>
  useQuery({
    queryKey: ['transactions', f],
    queryFn: () => api.get<Transaction[]>(`/transactions${qs(f)}`),
    placeholderData: keepPreviousData,
  });
export const useSummary = (f: TxFilter) =>
  useQuery({
    queryKey: ['summary', f],
    queryFn: () => api.get<Summary>(`/transactions/summary${qs(f)}`),
    placeholderData: keepPreviousData,
  });

/** Invalidate everything derived from transactions */
export function useInvalidateLedger() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['transactions'] }),
      qc.invalidateQueries({ queryKey: ['summary'] }),
      qc.invalidateQueries({ queryKey: ['accounts'] }),
      qc.invalidateQueries({ queryKey: ['budgets'] }),
      qc.invalidateQueries({ queryKey: ['stats'] }),
      qc.invalidateQueries({ queryKey: ['cycle'] }),
    ]);
}

export function useSaveTransaction() {
  const inv = useInvalidateLedger();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: TransactionInput }) =>
      id ? api.put<Transaction>(`/transactions/${id}`, data) : api.post<Transaction>('/transactions', data),
    onSuccess: inv,
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  const inv = useInvalidateLedger();
  return useMutation({
    mutationFn: (id: number) => api.del(`/transactions/${id}`),
    onMutate: async (id) => {
      // optimistic removal from every cached list
      await qc.cancelQueries({ queryKey: ['transactions'] });
      qc.setQueriesData<Transaction[]>({ queryKey: ['transactions'] }, (old) => old?.filter((t) => t.id !== id));
    },
    onSettled: inv,
  });
}

export function useRestoreTransaction() {
  const inv = useInvalidateLedger();
  return useMutation({ mutationFn: (id: number) => api.post(`/transactions/${id}/restore`), onSuccess: inv });
}

export function useSaveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: AccountInput }) =>
      id ? api.put<Account>(`/accounts/${id}`, data) : api.post<Account>('/accounts', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/accounts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
}
export function useReorder(kind: 'accounts' | 'categories') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put(`/${kind}/reorder`, { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: [kind] }),
  });
}

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: CategoryInput }) =>
      id ? api.put<Category>(`/categories/${id}`, data) : api.post<Category>('/categories', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}
export function useDeleteCategory() {
  const qc = useQueryClient();
  const inv = useInvalidateLedger();
  return useMutation({
    mutationFn: (id: number) => api.del(`/categories/${id}`),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['categories'] }), inv()]),
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<Tag>('/tags', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });
}

/** Lookup maps */
export function useLookups() {
  const { data: cats = [] } = useCategories();
  const { data: accs = [] } = useAccounts();
  const { data: tags = [] } = useTags();
  return {
    cats,
    accs,
    tags,
    catMap: new Map(cats.map((c) => [c.id, c])),
    accMap: new Map(accs.map((a) => [a.id, a])),
    tagMap: new Map(tags.map((t) => [t.id, t])),
  };
}

/* =========================== Phase 2 =========================== */
type Range = { from: string; to: string };

export const useTrend = (r: Range & { unit: 'day' | 'month' }, enabled = true) =>
  useQuery({
    queryKey: ['stats', 'trend', r],
    queryFn: () => api.get<TrendPoint[]>(`/stats/trend${qs(r)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useCategoryStats = (r: Range & { type: 'expense' | 'income'; parentId?: number | null }, enabled = true) =>
  useQuery({
    queryKey: ['stats', 'categories', r],
    queryFn: () => api.get<CategoryStat[]>(`/stats/categories${qs(r)}`),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useBudgets = (month: string) =>
  useQuery({ queryKey: ['budgets', month], queryFn: () => api.get<Budget[]>(`/budgets?month=${month}`), placeholderData: keepPreviousData });
export function useSaveBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: BudgetInput) => api.put('/budgets', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}
export function useDeleteBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/budgets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  });
}

export const useRecurring = () => useQuery({ queryKey: ['recurring'], queryFn: () => api.get<RecurringRule[]>('/recurring') });
export function useSaveRecurring() {
  const qc = useQueryClient();
  const inv = useInvalidateLedger();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: RecurringInput }) =>
      id
        ? api.put<{ rule: RecurringRule; created: number }>(`/recurring/${id}`, data)
        : api.post<{ rule: RecurringRule; created: number }>('/recurring', data),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['recurring'] }), inv()]),
  });
}
export function useDeleteRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/recurring/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring'] }),
  });
}

export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/templates') });
export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: TemplateInput }) =>
      id ? api.put<Template>(`/templates/${id}`, data) : api.post<Template>('/templates', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}
export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}
export function useReorderTemplates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.put('/templates/reorder', { ids }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => api.get<Goal[]>('/goals') });
export function useSaveGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: GoalInput }) =>
      id ? api.put<Goal>(`/goals/${id}`, data) : api.post<Goal>('/goals', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}
export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/goals/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}
export const useGoalEntries = (id: number | null) =>
  useQuery({ queryKey: ['goals', id, 'entries'], queryFn: () => api.get<GoalEntry[]>(`/goals/${id}/entries`), enabled: id != null });
export function useGoalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, note }: { id: number; amount: number; note?: string }) =>
      api.post<Goal>(`/goals/${id}/entries`, { amount, note: note ?? '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}
export function useDeleteGoalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, entryId }: { id: number; entryId: number }) => api.del(`/goals/${id}/entries/${entryId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  });
}

/* =========================== Phase 3 =========================== */
import type { CardCycle, ExchangeRate, InstallmentInput, InstallmentPlan } from '@ledger/shared';

export const useRates = () => useQuery({ queryKey: ['rates'], queryFn: () => api.get<ExchangeRate[]>('/rates') });
export function useSaveRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: { currency: string; rate: number }) => api.put('/rates', d),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['rates'] }), qc.invalidateQueries({ queryKey: ['accounts'] })]),
  });
}
export function useDeleteRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (currency: string) => api.del(`/rates/${currency}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rates'] }),
  });
}

export const useInstallments = () => useQuery({ queryKey: ['installments'], queryFn: () => api.get<InstallmentPlan[]>('/installments') });
export function useCreateInstallment() {
  const qc = useQueryClient();
  const inv = useInvalidateLedger();
  return useMutation({
    mutationFn: (d: InstallmentInput) => api.post<InstallmentPlan>('/installments', d),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['installments'] }), qc.invalidateQueries({ queryKey: ['cycle'] }), inv()]),
  });
}
export function useDeleteInstallment() {
  const qc = useQueryClient();
  const inv = useInvalidateLedger();
  return useMutation({
    mutationFn: ({ id, mode }: { id: number; mode: 'future' | 'all' }) => api.del<{ removed: number }>(`/installments/${id}?mode=${mode}`),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['installments'] }), qc.invalidateQueries({ queryKey: ['cycle'] }), inv()]),
  });
}

export const useCardCycle = (accountId: number | null) =>
  useQuery({ queryKey: ['cycle', accountId], queryFn: () => api.get<CardCycle>(`/accounts/${accountId}/cycle`), enabled: accountId != null });
