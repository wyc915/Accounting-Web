import {
  addDays, addMonths, addWeeks, addYears, endOfWeek, isSameYear, startOfDay, startOfMonth, startOfWeek, startOfYear,
} from 'date-fns';
import { fmt } from './format';

export type Mode = 'day' | 'week' | 'month' | 'year' | 'all';

export function periodOf(mode: Mode, anchor: Date): { from: Date | null; to: Date | null; label: string } {
  switch (mode) {
    case 'day': {
      const s = startOfDay(anchor);
      return { from: s, to: addDays(s, 1), label: fmt(s, 'yyyy年M月d日 EEEE') };
    }
    case 'week': {
      const s = startOfWeek(anchor, { weekStartsOn: 1 });
      const e = endOfWeek(anchor, { weekStartsOn: 1 });
      return { from: s, to: addDays(e, 1), label: `${fmt(s, 'M/d')} – ${fmt(e, isSameYear(s, e) ? 'M/d' : 'yyyy/M/d')}` };
    }
    case 'month': {
      const s = startOfMonth(anchor);
      return { from: s, to: addMonths(s, 1), label: fmt(s, 'yyyy 年 M 月') };
    }
    case 'year': {
      const s = startOfYear(anchor);
      return { from: s, to: addYears(s, 1), label: fmt(s, 'yyyy 年') };
    }
    default:
      return { from: null, to: null, label: '全部時間' };
  }
}

export const shift = (mode: Mode, d: Date, n: number) =>
  mode === 'day' ? addDays(d, n) : mode === 'week' ? addWeeks(d, n) : mode === 'month' ? addMonths(d, n) : addYears(d, n);
