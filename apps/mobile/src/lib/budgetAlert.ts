import { format } from 'date-fns';
import type { Budget, Category } from '@ledger/shared';
import { api } from './api';
import { money } from './format';
import { useUI } from '@/stores/ui';

/** After an expense is saved: warn if it pushed the category's or the total monthly budget over its limit. */
export async function checkBudgetAlert(date: Date, categoryId: number | null, cats: Category[]) {
  try {
    const list = await api.get<Budget[]>(`/budgets?month=${format(date, 'yyyy-MM')}`);
    const cat = cats.find((c) => c.id === categoryId);
    const parentId = cat ? (cat.parentId ?? cat.id) : null;
    const over = list.filter((b) => b.spent > b.amount && (b.categoryId == null || b.categoryId === parentId));
    const hit = over.find((b) => b.categoryId != null) ?? over[0];
    if (!hit) return;
    const name = hit.categoryId == null ? '本月總預算' : `「${cats.find((c) => c.id === hit.categoryId)?.name}」預算`;
    setTimeout(
      () => useUI.getState().toast({ message: `⚠ ${name}已超支 ${money(hit.spent - hit.amount)}`, tone: 'warn', duration: 5000 }),
      600,
    );
  } catch {
    /* non-critical */
  }
}
