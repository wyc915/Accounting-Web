import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, isSameDay, isSameMonth, isToday,
  startOfMonth, startOfWeek, subDays,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, fmt } from '@/lib/format';
import { spring } from './ui';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

export function Calendar({
  value, onChange, marks,
}: {
  value: Date;
  onChange: (d: Date) => void;
  /** optional dot markers by yyyy-MM-dd */
  marks?: Set<string>;
}) {
  const [month, setMonth] = useState(startOfMonth(value));
  const [dir, setDir] = useState(0);
  const go = (n: number) => {
    setDir(n);
    setMonth((m) => addMonths(m, n));
  };
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => go(-1)} className="grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="上個月">
          <ChevronLeft className="size-5" />
        </button>
        <span className="font-semibold">{fmt(month, 'yyyy 年 M 月')}</span>
        <button type="button" onClick={() => go(1)} className="grid size-9 place-items-center rounded-full hover:bg-surface-2" aria-label="下個月">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-muted">
        {WEEK.map((w) => (
          <span key={w} className="py-1">{w}</span>
        ))}
      </div>
      <div className="relative overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={month.toISOString()}
            custom={dir}
            initial={{ x: dir * 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -60, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="grid grid-cols-7 gap-y-1"
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, i) => {
              if (i.offset.x < -50) go(1);
              else if (i.offset.x > 50) go(-1);
            }}
          >
            {days.map((d) => {
              const sel = isSameDay(d, value);
              const key = fmt(d, 'yyyy-MM-dd');
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => onChange(d)}
                  className={cn(
                    'relative mx-auto grid size-10 place-items-center rounded-full text-sm transition-colors',
                    !isSameMonth(d, month) && 'text-muted/50',
                    !sel && 'hover:bg-surface-2',
                    isToday(d) && !sel && 'font-bold text-primary',
                  )}
                >
                  {sel && <motion.span layoutId="cal-sel" transition={spring} className="absolute inset-0 rounded-full bg-primary" />}
                  <span className={cn('relative', sel && 'font-semibold text-white dark:text-[#06231a]')}>{d.getDate()}</span>
                  {marks?.has(key) && !sel && <span className="absolute bottom-1 size-1 rounded-full bg-primary" />}
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Date + time chooser with quick chips */
export function DateTimePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  const setDay = (d: Date) => {
    const n = new Date(d);
    n.setHours(value.getHours(), value.getMinutes(), 0, 0);
    onChange(n);
  };
  const today = new Date();
  const chips = [
    { label: '今天', d: today },
    { label: '昨天', d: subDays(today, 1) },
    { label: '前天', d: subDays(today, 2) },
  ];
  const time = fmt(value, 'HH:mm');

  return (
    <div>
      <div className="flex items-center gap-2">
       <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto no-scrollbar">
        {chips.map((c) => {
          const active = isSameDay(c.d, value);
          return (
            <button
              type="button"
              key={c.label}
              onClick={() => {
                setDay(c.d);
                setOpen(false);
              }}
              className={cn(
                'h-9 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors',
                active ? 'bg-primary-soft text-primary-strong dark:text-primary' : 'bg-surface-2 text-muted hover:text-fg',
              )}
            >
              {c.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'h-9 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors',
            open || !chips.some((c) => isSameDay(c.d, value)) ? 'bg-fg text-bg' : 'bg-surface-2 text-muted hover:text-fg',
          )}
        >
          {fmt(value, 'M/d (EEEEE)')}
        </button>
       </div>
        <input
          type="time"
          value={time}
          onChange={(e) => {
            const [h, m] = e.target.value.split(':').map(Number);
            if (Number.isNaN(h)) return;
            const n = new Date(value);
            n.setHours(h, m);
            onChange(n);
          }}
          className="h-9 w-[128px] shrink-0 rounded-full bg-surface-2 px-2.5 text-center text-sm font-medium text-fg outline-none [color-scheme:light] dark:[color-scheme:dark]"
          aria-label="時間"
        />
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-2xl border border-border p-3">
              <Calendar
                value={value}
                onChange={(d) => {
                  setDay(d);
                  setOpen(false);
                }}
              />
              <div className="mt-2 flex justify-between text-xs">
                <button type="button" className="text-muted hover:text-fg" onClick={() => setDay(addDays(value, -7))}>
                  − 7 天
                </button>
                <button type="button" className="font-semibold text-primary" onClick={() => { setDay(today); setOpen(false); }}>
                  回到今天
                </button>
                <button type="button" className="text-muted hover:text-fg" onClick={() => setDay(addDays(value, 7))}>
                  + 7 天
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
