import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { periodOf, shift, type Mode } from '@/lib/period';

/** "‹ 2026 年 11 月 ›" with slide animation; tap label to return to current period */
export function PeriodNav({ mode, anchor, onChange }: { mode: Mode; anchor: Date; onChange: (d: Date) => void }) {
  const [dir, setDir] = useState(0);
  const p = periodOf(mode, anchor);
  const go = (n: number) => {
    setDir(n);
    onChange(shift(mode, anchor, n));
  };
  return (
    <div className="flex items-center justify-between">
      <button onClick={() => go(-1)} className="grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="上一期">
        <ChevronLeft className="size-5" />
      </button>
      <div className="relative h-6 flex-1 overflow-hidden text-center">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.button
            key={p.label}
            initial={{ x: dir * 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -40, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onChange(new Date())}
            className="w-full font-semibold"
            title="回到本期"
          >
            {p.label}
          </motion.button>
        </AnimatePresence>
      </div>
      <button onClick={() => go(1)} className="grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="下一期">
        <ChevronRight className="size-5" />
      </button>
    </div>
  );
}
