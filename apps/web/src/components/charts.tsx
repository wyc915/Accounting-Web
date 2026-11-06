import { useEffect, useState, type ReactNode } from 'react';
import { money } from '@/lib/format';

/** Reads chart tokens from CSS so SVG attributes get concrete colors (and update on theme switch). */
export function useChartColors() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
      income: v('--chart-income'),
      expense: v('--chart-expense'),
      grid: v('--chart-grid'),
      muted: v('--muted'),
      fg: v('--fg'),
      surface: v('--surface'),
    };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setC(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return c;
}

/** Shared tooltip shell: text in text tokens, colored key swatch carries identity */
export function TooltipCard({ title, rows }: { title?: ReactNode; rows: { color: string; label: string; value: number }[] }) {
  return (
    <div className="min-w-[150px] rounded-2xl border border-border bg-surface/95 px-3.5 py-2.5 text-sm shadow-xl backdrop-blur">
      {title && <p className="mb-1.5 text-xs font-medium text-muted">{title}</p>}
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-0.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: r.color }} />
          <span className="flex-1 text-muted">{r.label}</span>
          <span className="num font-semibold text-fg">{money(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-2 w-3.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** compact axis labels: 1.2萬 / 3500 */
export const shortMoney = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e8) return `${+(n / 1e8).toFixed(1)}億`;
  if (a >= 1e4) return `${+(n / 1e4).toFixed(1)}萬`;
  return String(Math.round(n));
};
